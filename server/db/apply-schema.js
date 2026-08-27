require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema-postgres.sql'), 'utf8');
    await sql.unsafe(schema);
    console.log('Schema applied.');
  } catch (err) {
    console.error('Schema apply failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
