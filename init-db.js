const { initializeDatabase } = require('./config/database');

async function init() {
  try {
    await initializeDatabase();
    console.log('Database initialization completed');
    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

init();