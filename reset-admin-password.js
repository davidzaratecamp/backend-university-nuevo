const bcrypt = require('bcryptjs');
const { pool } = require('./config/database');
require('dotenv').config();

async function resetAdminPassword() {
  try {
    const adminEmail = 'adminospina@asisteuniversity.com';
    const newPassword = 'ospinauniversity123!';

    console.log('Resetting admin password...');
    console.log('Email:', adminEmail);

    // Check if admin exists
    const [existingUser] = await pool.execute(
      'SELECT id, name, email, role FROM users WHERE email = ?',
      [adminEmail]
    );

    if (existingUser.length === 0) {
      console.log('❌ Admin user not found with email:', adminEmail);
      process.exit(1);
    }

    console.log('✅ Admin found:', existingUser[0]);

    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    console.log('New hashed password:', hashedPassword);

    // Update password
    const [result] = await pool.execute(
      'UPDATE users SET password = ? WHERE email = ?',
      [hashedPassword, adminEmail]
    );

    if (result.affectedRows > 0) {
      console.log('\n✅ Password updated successfully!');
      console.log('📧 Email:', adminEmail);
      console.log('🔑 Password:', newPassword);
      console.log('\nYou can now login with these credentials.');
    } else {
      console.log('❌ Failed to update password');
    }

  } catch (error) {
    console.error('❌ Error resetting password:', error);
  } finally {
    process.exit(0);
  }
}

resetAdminPassword();
