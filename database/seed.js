const path = require('path');
const { DB_FILE_PATH } = require('./db-config');

(async () => {
  console.log('Database initialization and admin setup is now handled automatically on app startup.');
  console.log('Database file: ' + DB_FILE_PATH);
  console.log('');
  console.log('✓ Database tables and indexes are created automatically when the app starts.');
  console.log('✓ Default admin account is created automatically on first startup if none exists.');
  console.log('');
  console.log('This script is optional. You only need to run `npm start` to initialize everything.');
  console.log('');
  console.log('For development/testing purposes, you can delete the database file and restart the app');
  console.log('to start fresh with a new default admin account.');
  process.exit(0);
})();