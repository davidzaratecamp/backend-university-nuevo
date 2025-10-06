const { pool } = require('./config/database');
require('dotenv').config();

async function updateAdminProfile() {
  try {
    // URL de la foto del perfil del admin
    const profileImageUrl = 'https://ejemplo.com/foto-admin.jpg'; // Reemplaza con la URL real
    const bio = 'Director de formadores y administrador del sistema de inducción';

    const [result] = await pool.execute(
      `UPDATE users
       SET profile_image = ?, bio = ?
       WHERE email = ?`,
      [profileImageUrl, bio, 'admin@asisteuniversity.com']
    );

    if (result.affectedRows > 0) {
      console.log('✅ Perfil del administrador actualizado exitosamente!');
      console.log('📸 Foto de perfil:', profileImageUrl);
      console.log('📝 Biografía:', bio);
    } else {
      console.log('❌ No se encontró el usuario administrador');
    }
  } catch (error) {
    console.error('Error actualizando perfil del admin:', error);
  } finally {
    process.exit(0);
  }
}

updateAdminProfile();
