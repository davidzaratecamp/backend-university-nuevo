const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, profile_image, bio, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({ users: rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/students:
 *   get:
 *     summary: Get all students (admin and formador)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/students', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const query = `
      SELECT u.id, u.name, u.email, u.profile_image, u.bio, u.created_at,
             GROUP_CONCAT(DISTINCT c.title) as assigned_courses,
             COUNT(DISTINCT ca.course_id) as course_count
      FROM users u
      LEFT JOIN course_assignments ca ON u.id = ca.student_id
      LEFT JOIN courses c ON ca.course_id = c.id
      WHERE u.role = 'estudiante'
      GROUP BY u.id, u.name, u.email, u.profile_image, u.bio, u.created_at
      ORDER BY u.created_at DESC
    `;

    const [rows] = await pool.execute(query);

    res.json({ students: rows });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/students/{id}/details:
 *   get:
 *     summary: Get student details with course assignments
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/students/:id/details', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { id } = req.params;

    // Get student basic info
    const [studentRows] = await pool.execute(
      'SELECT id, name, email, profile_image, bio, created_at FROM users WHERE id = ? AND role = "estudiante"',
      [id]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const student = studentRows[0];

    // Get course assignments with assignor info
    const [assignmentRows] = await pool.execute(
      `SELECT ca.id, ca.assigned_at, c.id as course_id, c.title as course_title, 
              c.description as course_description, u.name as assigned_by_name
       FROM course_assignments ca
       JOIN courses c ON ca.course_id = c.id
       JOIN users u ON ca.assigned_by = u.id
       WHERE ca.student_id = ?
       ORDER BY ca.assigned_at DESC`,
      [id]
    );

    res.json({ 
      student: {
        ...student,
        assignments: assignmentRows
      }
    });
  } catch (error) {
    console.error('Get student details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/formadores:
 *   get:
 *     summary: Get all formadores (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/formadores', auth, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.created_at,
              COUNT(DISTINCT sf.student_id) as student_count
       FROM users u
       LEFT JOIN student_formador sf ON u.id = sf.formador_id
       WHERE u.role = 'formador'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    res.json({ formadores: rows });
  } catch (error) {
    console.error('Get formadores error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { name, email, password, role, profile_image, bio } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (req.user.role === 'formador' && role !== 'estudiante') {
      return res.status(403).json({ message: 'Formadores can only create students' });
    }

    if (!['admin', 'formador', 'estudiante'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role, profile_image, bio) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hashedPassword, role, profile_image || null, bio || null]
    );

    if (req.user.role === 'formador' && role === 'estudiante') {
      await pool.execute(
        'INSERT INTO student_formador (student_id, formador_id) VALUES (?, ?)',
        [result.insertId, req.user.id]
      );
    }

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: result.insertId,
        name,
        email,
        role
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, profile_image, bio, password } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ message: 'Name, email, and role are required' });
    }

    if (!['admin', 'formador', 'estudiante'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    // Verificar permisos del formador
    if (req.user.role === 'formador') {
      // Verificar que el usuario a editar sea un estudiante
      const [userToEdit] = await pool.execute(
        'SELECT role FROM users WHERE id = ?',
        [id]
      );
      
      if (userToEdit.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      if (userToEdit[0].role !== 'estudiante') {
        return res.status(403).json({ message: 'Formadores can only edit students' });
      }
      
      // Los formadores no pueden cambiar roles
      if (role !== 'estudiante') {
        return res.status(403).json({ message: 'Formadores cannot change user roles' });
      }
    }

    const [existingUser] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, id]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Si se proporciona una nueva contraseña, encriptarla y actualizar
    if (password && password.trim() !== '') {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, role = ?, profile_image = ?, bio = ?, password = ? WHERE id = ?',
        [name, email, role, profile_image || null, bio || null, hashedPassword, id]
      );
    } else {
      // Si no se proporciona contraseña, no actualizarla
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, role = ?, profile_image = ?, bio = ? WHERE id = ?',
        [name, email, role, profile_image || null, bio || null, id]
      );
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/my-formadores:
 *   get:
 *     summary: Get my formadores (student only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-formadores', auth, authorize('estudiante'), async (req, res) => {
  try {
    // Obtener el administrador (Director de Formadores)
    const [adminRows] = await pool.execute(
      `SELECT id, name, email, profile_image, bio, created_at,
              'Director de Formadores' as position,
              NULL as assigned_at,
              NULL as shared_courses,
              0 as course_count
       FROM users
       WHERE role = 'admin'
       LIMIT 1`
    );

    // Obtener formadores directamente asignados al estudiante desde la tabla student_formador
    const [formadorRows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.profile_image, u.bio, u.created_at,
              'Formador' as position,
              sf.assigned_at,
              GROUP_CONCAT(DISTINCT c.title) as shared_courses,
              COUNT(DISTINCT fc.course_id) as course_count
       FROM users u
       INNER JOIN student_formador sf ON u.id = sf.formador_id
       LEFT JOIN formador_courses fc ON u.id = fc.formador_id
       LEFT JOIN course_assignments ca ON fc.course_id = ca.course_id AND ca.student_id = ?
       LEFT JOIN courses c ON fc.course_id = c.id
       WHERE sf.student_id = ? AND u.role = 'formador'
       GROUP BY u.id, u.name, u.email, u.profile_image, u.bio, u.created_at, sf.assigned_at
       ORDER BY sf.assigned_at DESC`,
      [req.user.id, req.user.id]
    );

    // Combinar: primero el admin, luego los formadores
    const allFormadores = [...adminRows, ...formadorRows];

    res.json({ formadores: allFormadores });
  } catch (error) {
    console.error('Get my formadores error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/formador/{formadorId}/assign-course:
 *   post:
 *     summary: Assign course to formador
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post('/formador/:formadorId/assign-course', auth, authorize('admin'), async (req, res) => {
  try {
    const { formadorId } = req.params;
    const { course_id } = req.body;

    if (!course_id) {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    // Verify formador exists and has correct role
    const [formadorRows] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND role = "formador"',
      [formadorId]
    );

    if (formadorRows.length === 0) {
      return res.status(404).json({ message: 'Formador not found' });
    }

    // Verify course exists
    const [courseRows] = await pool.execute(
      'SELECT id FROM courses WHERE id = ?',
      [course_id]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    try {
      await pool.execute(
        'INSERT INTO formador_courses (formador_id, course_id, assigned_by) VALUES (?, ?, ?)',
        [formadorId, course_id, req.user.id]
      );

      res.status(201).json({ message: 'Course assigned to formador successfully' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: 'Course already assigned to this formador' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Assign course to formador error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/formador/{formadorId}/courses:
 *   get:
 *     summary: Get formador's assigned courses
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/formador/:formadorId/courses', auth, authorize('admin'), async (req, res) => {
  try {
    const { formadorId } = req.params;

    const [rows] = await pool.execute(
      `SELECT c.id, c.title, c.description, fc.assigned_at, u.name as assigned_by_name
       FROM formador_courses fc
       JOIN courses c ON fc.course_id = c.id
       JOIN users u ON fc.assigned_by = u.id
       WHERE fc.formador_id = ?
       ORDER BY fc.assigned_at DESC`,
      [formadorId]
    );

    res.json({ courses: rows });
  } catch (error) {
    console.error('Get formador courses error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/formador/{formadorId}/unassign-course:
 *   delete:
 *     summary: Unassign course from formador
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/formador/:formadorId/unassign-course/:courseId', auth, authorize('admin'), async (req, res) => {
  try {
    const { formadorId, courseId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM formador_courses WHERE formador_id = ? AND course_id = ?',
      [formadorId, courseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    res.json({ message: 'Course unassigned from formador successfully' });
  } catch (error) {
    console.error('Unassign course from formador error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;