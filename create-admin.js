const bcrypt = require('bcryptjs');
const { pool } = require('./config/database');
require('dotenv').config();

async function createAdminUser() {
  try {
    const adminData = {
      name: 'Admin Ospina',
      email: 'adminospina@asisteuniversity.com',
      password: 'ospinauniversity123!',
      role: 'admin'
    };

    // Check if admin already exists
    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [adminData.email]
    );

    if (existingUser.length > 0) {
      console.log('Admin user already exists!');
      console.log('Email:', adminData.email);
      console.log('Password: ospinauniversity123!');
      return;
    }

    // Create admin user
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(adminData.password, saltRounds);

    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [adminData.name, adminData.email, hashedPassword, adminData.role]
    );

    console.log('Admin user created successfully!');
    console.log('ID:', result.insertId);
    console.log('Email:', adminData.email);
    console.log('Password: ospinauniversity123!');
    console.log('Role:', adminData.role);

    // Also create a formador and estudiante for testing
    const formadorPassword = await bcrypt.hash('formador123', saltRounds);
    const estudiantePassword = await bcrypt.hash('estudiante123', saltRounds);

    await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Juan Formador', 'formador@asisteuniversity.com', formadorPassword, 'formador']
    );

    await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['María Estudiante', 'estudiante@asisteuniversity.com', estudiantePassword, 'estudiante']
    );

    console.log('\nTest users created:');
    console.log('Formador - Email: formador@asisteuniversity.com, Password: formador123');
    console.log('Estudiante - Email: estudiante@asisteuniversity.com, Password: estudiante123');

  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    process.exit(0);
  }
}

createAdminUser();