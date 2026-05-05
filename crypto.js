// src/crypto.js — wallet generation + send logic for LTC and BEP-20
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');
const { ethers } = require('ethers');
const axios = require('axios');

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// ─── LTC network definition ───────────────────────────────────────────────────
const LTC_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

// ─── Generate a fresh LTC wallet ──────────────────────────────────────────────
function generateLTCWallet() {
  const keyPair = ECPair.makeRandom({ network: LTC_NETWORK });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: LTC_NETWORK,
  });
  const wif = keyPair.toWIF();
  return { address, privateKey: wif, type: 'LTC' };
}

// ─── Generate a fresh BEP-20 (BSC) wallet ────────────────────────────────────
function generateBEP20Wallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    type: 'BEP20',
  };
}

// ─── Get LTC balance via BlockCypher ─────────────────────────────────────────
async function getLTCBalance(address) {
  try {
    const token = process.env.BLOCKCYPHER_TOKEN
      ? `?token=${process.env.BLOCKCYPHER_TOKEN}`
      : '';
    const res = await axios.get(
      `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance${token}`
    );
    // balance is in litoshis (1 LTC = 1e8 litoshis)
    return res.data.balance / 1e8;
  } catch {
    return 0;
  }
}

// ─── Get BEP-20 BNB balance ───────────────────────────────────────────────────
async function getBEP20Balance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
    const bal = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(bal));
  } catch {
    return 0;
  }
}

// ─── Get current LTC/USD price ────────────────────────────────────────────────
async function getLTCPrice() {
  const res = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd'
  );
  return res.data.litecoin.usd;
}

// ─── Get current BNB/USD price ────────────────────────────────────────────────
async function getBNBPrice() {
  const res = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd'
  );
  return res.data.binancecoin.usd;
}

// ─── Send LTC from escrow wallet ─────────────────────────────────────────────
// Sends (amount - fee) to receiver, fee% to fee address
async function sendLTC({ wif, fromAddress, receiverAddress, feeAddress, totalLTC }) {
  const FEE_PERCENT = parseFloat(process.env.FEE_PERCENT || '1') / 100;
  const feeLTC = parseFloat((totalLTC * FEE_PERCENT).toFixed(8));
  const receiverLTC = parseFloat((totalLTC - feeLTC - 0.001).toFixed(8)); // 0.001 LTC network fee

  if (receiverLTC <= 0) throw new Error('Amount too small to cover network fees');

  const tokenQ = process.env.BLOCKCYPHER_TOKEN
    ? `?token=${process.env.BLOCKCYPHER_TOKEN}`
    : '';

  // Fetch UTXOs
  const utxoRes = await axios.get(
    `https://api.blockcypher.com/v1/ltc/main/addrs/${fromAddress}?unspentOnly=true&includeScript=true${tokenQ.replace('?', '&')}`
  );
  const utxos = utxoRes.data.txrefs || [];
  if (!utxos.length) throw new Error('No UTXOs available to spend');

  const keyPair = ECPair.fromWIF(wif, LTC_NETWORK);
  const psbt = new bitcoin.Psbt({ network: LTC_NETWORK });

  let inputSum = 0;
  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.tx_hash,
      index: utxo.tx_output_n,
      nonWitnessUtxo: Buffer.from(utxo.script, 'hex'),
    });
    inputSum += utxo.value;
  }

  const toLitoshis = (ltc) => Math.round(ltc * 1e8);

  psbt.addOutput({ address: receiverAddress, value: toLitoshis(receiverLTC) });
  if (feeLTC > 0.00001) {
    psbt.addOutput({ address: feeAddress, value: toLitoshis(feeLTC) });
  }

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();

  // Broadcast
  const broadcast = await axios.post(
    `https://api.blockcypher.com/v1/ltc/main/txs/push${tokenQ}`,
    { tx: txHex }
  );

  return {
    txid: broadcast.data.tx.hash,
    receiverLTC,
    feeLTC,
  };
}

// ─── Send BNB (BEP-20) from escrow wallet ────────────────────────────────────
async function sendBEP20({ privateKey, receiverAddress, feeAddress, totalBNB }) {
  const FEE_PERCENT = parseFloat(process.env.FEE_PERCENT || '1') / 100;
  const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  const gasLimit = BigInt(21000);
  const gasCost = gasPrice * gasLimit;

  const totalWei = ethers.parseEther(totalBNB.toFixed(18));
  const feeWei = (totalWei * BigInt(Math.round(FEE_PERCENT * 10000))) / BigInt(1000000);
  const receiverWei = totalWei - feeWei - gasCost * BigInt(2); // gas for 2 txns

  if (receiverWei <= BigInt(0)) throw new Error('Amount too small to cover gas fees');

  // Send to receiver
  const tx1 = await wallet.sendTransaction({
    to: receiverAddress,
    value: receiverWei,
    gasLimit,
    gasPrice,
  });
  await tx1.wait();

  // Send fee
  let tx2Hash = null;
  if (feeWei > BigInt(0)) {
    const tx2 = await wallet.sendTransaction({
      to: feeAddress,
      value: feeWei,
      gasLimit,
      gasPrice,
    });
    await tx2.wait();
    tx2Hash = tx2.hash;
  }

  return {
    txid: tx1.hash,
    feeTxid: tx2Hash,
    receiverBNB: parseFloat(ethers.formatEther(receiverWei)),
    feeBNB: parseFloat(ethers.formatEther(feeWei)),
  };
}

module.exports = {
  generateLTCWallet,
  generateBEP20Wallet,
  getLTCBalance,
  getBEP20Balance,
  getLTCPrice,
  getBNBPrice,
  sendLTC,
  sendBEP20,
};
