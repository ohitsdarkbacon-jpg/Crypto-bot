// register.js — run once with: node src/register.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
 
const commands = [
  {
    name: 'escrow',
    description: 'Create a new escrow ticket',
    options: [
      {
        name: 'receiver',
        description: 'The Discord user receiving the item',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'item',
        description: 'Description of the item being traded',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'amount',
        description: 'Agreed USD value of the trade',
        type: ApplicationCommandOptionType.Number,
        required: true,
      },
      {
        name: 'crypto',
        description: 'Which crypto to use for payment',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Litecoin (LTC)', value: 'LTC' },
          { name: 'BEP-20 (BNB Smart Chain)', value: 'BEP20' },
        ],
      },
    ],
  },
  {
    name: 'ticket',
    description: 'Look up an escrow ticket by ID',
    options: [
      {
        name: 'id',
        description: 'Ticket ID',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'setfeeaddress',
    description: '[Admin] Set the fee recipient wallet address',
    options: [
      {
        name: 'crypto',
        description: 'Which crypto fee address to update',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Litecoin (LTC)', value: 'LTC' },
          { name: 'BEP-20 (BNB Smart Chain)', value: 'BEP20' },
        ],
      },
      {
        name: 'address',
        description: 'The wallet address to receive fees',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'feestatus',
    description: '[Admin] View current fee configuration',
  },
];
 
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
 
(async () => {
  try {
    console.log('📡 Registering slash commands globally...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log('✅ Slash commands registered globally.');
    console.log('⚠️  Global commands can take up to 1 hour to appear in Discord.');
    console.log('💡 Tip: Pass a GUILD_ID env var to register instantly to one server.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
 
