require('dotenv').config();
const pool = require('../../src/config/db');

async function createFeeWallet() {
  const client = await pool.connect();

  try {
    console.log('🌱 Creating fee wallet account...');

    const existing = await client.query(
      `SELECT * FROM accounts WHERE type = 'fee_wallet' LIMIT 1`
    );

    if (existing.rows.length > 0) {
      console.log('✅ Fee wallet already exists:', existing.rows[0].id);
      console.log('\n📋 Add this to your .env file:');
      console.log(`FEE_ACCOUNT_ID=${existing.rows[0].id}`);
      return;
    }

    const result = await client.query(
      `INSERT INTO accounts (user_id, type, currency, status)
       VALUES (gen_random_uuid(), 'fee_wallet', 'NGN', 'active')
       RETURNING *`
    );

    const feeWallet = result.rows[0];

    console.log('✅ Fee wallet created successfully!');
    console.log('   ID:', feeWallet.id);
    console.log('   Type:', feeWallet.type);
    console.log('\n📋 Add this to your .env file:');
    console.log(`FEE_ACCOUNT_ID=${feeWallet.id}`);

  } catch (error) {
    console.error('❌ Failed to create fee wallet:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createFeeWallet().catch(() => process.exit(1));