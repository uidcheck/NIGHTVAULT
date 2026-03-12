const path = require('path');
const { DB_FILE_PATH } = require('./db-config');

(async () => {
  console.log('Database initialization and admin setup is now handled automatically on app startup.');
  console.log('Database file: ' + DB_FILE_PATH);
  console.log('');
  console.log('✓ Database tables and indexes are created automatically when the app starts.');
  console.log('✓ If no admin exists, use the one-time /setup flow or INITIAL_ADMIN_* environment variables.');
  console.log('');
  console.log('This script is optional. You only need to run `npm start` to initialize everything.');
  console.log('');
  console.log('For development/testing purposes, you can delete the database file and restart the app');
  console.log('to start fresh with a new setup flow.');
  process.exit(0);
})();