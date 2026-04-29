require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const migrationsDir = path.join(__dirname, 'migrations');

async function runMigrations() {
  console.log('🔄 Running migrations...\n');

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`📁 Found ${files.length} migration files`);

  let client;

  try {
    console.log('🔌 Connecting to database...');
    client = await pool.connect();
    console.log('✅ Database connected\n');

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`⏳ Running: ${file}`);

      try {
        await client.query(sql);
        console.log(`✅ Done: ${file}\n`);
      } catch (err) {
        console.error(`❌ Failed on ${file}:`, err.message);
        throw err;
      }
    }

    console.log('🎉 All migrations completed successfully!');

  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
    console.log('🔌 Database connection closed');
  }
}

runMigrations();