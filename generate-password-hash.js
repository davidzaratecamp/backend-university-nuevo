const bcrypt = require('bcryptjs');

async function generatePasswordHash() {
  const password = 'ospinauniversity123!';
  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);

  console.log('\n🔐 Password Hash Generator');
  console.log('========================');
  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('\n📋 SQL Query to run in production:');
  console.log('========================\n');
  console.log(`UPDATE users SET password = '${hash}' WHERE email = 'adminospina@asisteuniversity.com';`);
  console.log('\n========================\n');
}

generatePasswordHash();
