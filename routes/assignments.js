const express = require('express');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/assignments:
 *   get:
 *     summary: Get course assignments
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    let query = `
      SELECT ca.*, c.title as course_title, s.name as student_name, s.email as student_email,
             u.name as assigned_by_name
      FROM course_assignments ca
      JOIN courses c ON ca.course_id = c.id
      JOIN users s ON ca.student_id = s.id
      JOIN users u ON ca.assigned_by = u.id
    `;

    let params = [];

    if (req.user.role === 'formador') {
      query += ' WHERE ca.assigned_by = ? OR ca.student_id IN (SELECT student_id FROM student_formador WHERE formador_id = ?)';
      params = [req.user.id, req.user.id];
    }

    query += ' ORDER BY ca.assigned_at DESC';

    const [rows] = await pool.execute(query, params);

    res.json({ assignments: rows });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments:
 *   post:
 *     summary: Assign course to student
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { course_id, student_id } = req.body;

    if (!course_id || !student_id) {
      return res.status(400).json({ message: 'Course ID and Student ID are required' });
    }

    const [studentRows] = await pool.execute(
      'SELECT id, role FROM users WHERE id = ? AND role = "estudiante"',
      [student_id]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const [courseRows] = await pool.execute(
      'SELECT id FROM courses WHERE id = ?',
      [course_id]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // For formadores, we allow assignment to any student since they can assign courses
    // The permission is handled at the course level through formador_courses table

    try {
      await pool.execute(
        'INSERT INTO course_assignments (course_id, student_id, assigned_by) VALUES (?, ?, ?)',
        [course_id, student_id, req.user.id]
      );

      res.status(201).json({ message: 'Course assigned successfully' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: 'Student is already assigned to this course' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/{id}:
 *   delete:
 *     summary: Remove course assignment
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { id } = req.params;

    let query = 'DELETE FROM course_assignments WHERE id = ?';
    let params = [id];

    if (req.user.role === 'formador') {
      query = `DELETE ca FROM course_assignments ca 
               JOIN student_formador sf ON ca.student_id = sf.student_id 
               WHERE ca.id = ? AND sf.formador_id = ?`;
      params = [id, req.user.id];
    }

    const [result] = await pool.execute(query, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Assignment not found or not authorized' });
    }

    res.json({ message: 'Assignment removed successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/student/{studentId}:
 *   get:
 *     summary: Get assignments for a specific student
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/student/:studentId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { studentId } = req.params;

    // For formadores, we allow access to any student since they can assign courses
    // The permission is handled at the course level through formador_courses table

    const [rows] = await pool.execute(
      `SELECT ca.*, c.title as course_title, c.description as course_description,
              u.name as assigned_by_name
       FROM course_assignments ca
       JOIN courses c ON ca.course_id = c.id
       JOIN users u ON ca.assigned_by = u.id
       WHERE ca.student_id = ?
       ORDER BY ca.assigned_at DESC`,
      [studentId]
    );

    res.json({ assignments: rows });
  } catch (error) {
    console.error('Get student assignments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/student/{studentId}/courses:
 *   get:
 *     summary: Get course IDs assigned to a student
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/student/:studentId/courses', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { studentId } = req.params;

    // For formadores, we allow access to any student since they can assign courses
    // The permission is handled at the course level through formador_courses table

    const [rows] = await pool.execute(
      'SELECT course_id FROM course_assignments WHERE student_id = ?',
      [studentId]
    );

    const courseIds = rows.map(row => row.course_id);
    res.json({ courseIds });
  } catch (error) {
    console.error('Get student course IDs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/student/{studentId}/course/{courseId}:
 *   delete:
 *     summary: Remove course assignment from student
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/student/:studentId/course/:courseId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    // For formadores, we allow access to any student since they can assign courses
    // The permission is handled at the course level through formador_courses table

    const [result] = await pool.execute(
      'DELETE FROM course_assignments WHERE student_id = ? AND course_id = ?',
      [studentId, courseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    res.json({ message: 'Course unassigned successfully' });
  } catch (error) {
    console.error('Remove course assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/course/{courseId}/students:
 *   get:
 *     summary: Get students with assignment status for a course
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId/students', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { courseId } = req.params;

    // For formadores, we allow access to all courses since they can assign courses to students
    // This is consistent with the course listing endpoint

    // Get all students with their assignment status for this course
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.profile_image,
              ca.id as assignment_id,
              CASE WHEN ca.id IS NOT NULL THEN 1 ELSE 0 END as is_assigned
       FROM users u
       LEFT JOIN course_assignments ca ON u.id = ca.student_id AND ca.course_id = ?
       WHERE u.role = 'estudiante'
       ORDER BY is_assigned DESC, u.name ASC`,
      [courseId]
    );

    const assignedStudents = rows.filter(student => student.is_assigned);
    const unassignedStudents = rows.filter(student => !student.is_assigned);

    res.json({ 
      assignedStudents, 
      unassignedStudents,
      totalStudents: rows.length
    });
  } catch (error) {
    console.error('Get course students error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/assignments/formador-students:
 *   post:
 *     summary: Assign formador to student
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 */
router.post('/formador-students', auth, authorize('admin'), async (req, res) => {
  try {
    const { formador_id, student_id } = req.body;

    if (!formador_id || !student_id) {
      return res.status(400).json({ message: 'Formador ID and Student ID are required' });
    }

    const [formadorRows] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND role = "formador"',
      [formador_id]
    );

    if (formadorRows.length === 0) {
      return res.status(404).json({ message: 'Formador not found' });
    }

    const [studentRows] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND role = "estudiante"',
      [student_id]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    try {
      await pool.execute(
        'INSERT INTO student_formador (student_id, formador_id) VALUES (?, ?)',
        [student_id, formador_id]
      );

      res.status(201).json({ message: 'Formador assigned to student successfully' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: 'Formador is already assigned to this student' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Assign formador error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;