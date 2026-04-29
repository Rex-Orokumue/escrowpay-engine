require('dotenv').config();
const pool = require('../../src/config/db');

async function createSystemAccount() {
  const client = await pool.connect();

  try {
    console.log('🌱 Creating system account...');

    // Check if system account already exists
    const existing = await client.query(
      `SELECT * FROM accounts WHERE type = 'system' LIMIT 1`
    );

    if (existing.rows.length > 0) {
      console.log('✅ System account already exists:', existing.rows[0].id);
      console.log('\n📋 Add this to your .env file:');
      console.log(`SYSTEM_ACCOUNT_ID=${existing.rows[0].id}`);
      return;
    }

    // Create system account
    const result = await client.query(
      `INSERT INTO accounts (user_id, type, currency, status)
       VALUES (gen_random_uuid(), 'system', 'NGN', 'active')
       RETURNING *`
    );

    const systemAccount = result.rows[0];

    console.log('✅ System account created successfully!');
    console.log('   ID:', systemAccount.id);
    console.log('   Type:', systemAccount.type);
    console.log('   Currency:', systemAccount.currency);
    console.log('   Status:', systemAccount.status);
    console.log('\n📋 Add this to your .env file:');
    console.log(`SYSTEM_ACCOUNT_ID=${systemAccount.id}`);

  } catch (error) {
    console.error('❌ Failed to create system account:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createSystemAccount().catch(() => process.exit(1));