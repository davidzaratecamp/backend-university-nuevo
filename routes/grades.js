const express = require('express');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/grades/my-grades:
 *   get:
 *     summary: Get my grades (student only)
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-grades', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.*, q.title as quiz_title, a.title as activity_title, c.title as course_title,
              q.passing_score
       FROM grades g
       JOIN quizzes q ON g.quiz_id = q.id
       JOIN activities a ON q.activity_id = a.id
       JOIN courses c ON a.course_id = c.id
       WHERE g.student_id = ?
       ORDER BY g.completed_at DESC`,
      [req.user.id]
    );

    res.json({ grades: rows });
  } catch (error) {
    console.error('Get my grades error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/quiz:
 *   post:
 *     summary: Submit quiz grade
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.post('/quiz', auth, async (req, res) => {
  try {
    const { student_id, quiz_id, score, max_score, percentage, answers } = req.body;

    // Check if student is submitting their own grade or if admin/formador
    if (req.user.role === 'estudiante' && req.user.id != student_id) {
      return res.status(403).json({ message: 'You can only submit your own grades' });
    }

    // Get quiz questions to calculate correct score
    const [questionRows] = await pool.execute(
      `SELECT id, question, correct_answer, points
       FROM quiz_questions 
       WHERE quiz_id = ? 
       ORDER BY order_index`,
      [quiz_id]
    );

    if (questionRows.length === 0) {
      return res.status(404).json({ message: 'Quiz questions not found' });
    }

    // Calculate actual score
    let correctAnswers = 0;
    let totalPoints = 0;
    let correctCount = 0;

    questionRows.forEach(question => {
      totalPoints += question.points;
      const studentAnswer = answers[question.id];
      
      // Convert both to numbers for proper comparison
      const studentAnswerInt = parseInt(studentAnswer);
      const correctAnswerInt = parseInt(question.correct_answer);
      
      if (studentAnswerInt === correctAnswerInt) {
        correctAnswers += question.points;
        correctCount++;
      }
    });

    const calculatedPercentage = Math.round((correctAnswers / totalPoints) * 100);

    // Get current attempt number
    const [existingGrades] = await pool.execute(
      'SELECT MAX(attempt_number) as max_attempt FROM grades WHERE student_id = ? AND quiz_id = ?',
      [student_id, quiz_id]
    );
    
    const attemptNumber = (existingGrades[0].max_attempt || 0) + 1;

    const [result] = await pool.execute(
      `INSERT INTO grades (student_id, quiz_id, score, max_score, percentage, student_answers, attempt_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [student_id, quiz_id, correctAnswers, totalPoints, calculatedPercentage, JSON.stringify(answers), attemptNumber]
    );

    res.status(201).json({ 
      message: 'Grade submitted successfully',
      gradeId: result.insertId,
      attemptNumber,
      score: correctAnswers,
      max_score: totalPoints,
      percentage: calculatedPercentage,
      correct_count: correctCount
    });
  } catch (error) {
    console.error('Submit quiz grade error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/workshop:
 *   post:
 *     summary: Submit workshop grade
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.post('/workshop', auth, async (req, res) => {
  try {
    const { student_id, workshop_id, score, max_score, percentage, answers } = req.body;

    // Check if student is submitting their own grade or if admin/formador
    if (req.user.role === 'estudiante' && req.user.id != student_id) {
      return res.status(403).json({ message: 'You can only submit your own grades' });
    }

    // Get current attempt number
    const [existingGrades] = await pool.execute(
      'SELECT MAX(attempt_number) as max_attempt FROM workshop_grades WHERE student_id = ? AND workshop_id = ?',
      [student_id, workshop_id]
    );
    
    const attemptNumber = (existingGrades[0].max_attempt || 0) + 1;

    const [result] = await pool.execute(
      `INSERT INTO workshop_grades (student_id, workshop_id, score, max_score, percentage, student_answers, attempt_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [student_id, workshop_id, score, max_score, percentage, JSON.stringify(answers), attemptNumber]
    );

    res.status(201).json({ 
      message: 'Workshop grade submitted successfully',
      gradeId: result.insertId,
      attemptNumber 
    });
  } catch (error) {
    console.error('Submit workshop grade error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/student/{studentId}:
 *   get:
 *     summary: Get grades for a student
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/student/:studentId', auth, authorize('admin', 'formador', 'estudiante'), async (req, res) => {
  try {
    const { studentId } = req.params;

    // Students can only view their own grades
    if (req.user.role === 'estudiante' && req.user.id != studentId) {
      return res.status(403).json({ message: 'You can only view your own grades' });
    }

    // Verify that the requested student exists and is actually a student
    if (req.user.role === 'formador' || req.user.role === 'admin') {
      const [studentExists] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND role = "estudiante"',
        [studentId]
      );

      if (studentExists.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
    }

    // Get quiz grades
    const [quizGrades] = await pool.execute(
      `SELECT g.*, q.title as quiz_title, a.title as activity_title, c.title as course_title,
              q.passing_score, u.name as student_name, u.email as student_email,
              'quiz' as grade_type
       FROM grades g
       JOIN quizzes q ON g.quiz_id = q.id
       JOIN activities a ON q.activity_id = a.id
       JOIN courses c ON a.course_id = c.id
       JOIN users u ON g.student_id = u.id
       WHERE g.student_id = ?
       ORDER BY g.completed_at DESC`,
      [studentId]
    );

    // Get workshop grades
    const [workshopGrades] = await pool.execute(
      `SELECT wg.id, wg.student_id, wg.workshop_id as quiz_id, wg.score, wg.max_score, 
              wg.percentage, wg.attempt_number, wg.completed_at,
              w.title as quiz_title, a.title as activity_title, c.title as course_title,
              70 as passing_score, u.name as student_name, u.email as student_email,
              'workshop' as grade_type
       FROM workshop_grades wg
       JOIN workshops w ON wg.workshop_id = w.id
       JOIN activities a ON w.activity_id = a.id
       JOIN courses c ON a.course_id = c.id
       JOIN users u ON wg.student_id = u.id
       WHERE wg.student_id = ?
       ORDER BY wg.completed_at DESC`,
      [studentId]
    );

    // Combine both types of grades
    const allGrades = [...quizGrades, ...workshopGrades].sort((a, b) => 
      new Date(b.completed_at) - new Date(a.completed_at)
    );

    res.json({ grades: allGrades });
  } catch (error) {
    console.error('Get student grades error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/all:
 *   get:
 *     summary: Get all grades (admin and formador only)
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/all', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    // Get quiz grades
    const [quizGrades] = await pool.execute(
      `SELECT g.*, q.title as quiz_title, a.title as activity_title, c.title as course_title,
              q.passing_score, u.name as student_name, u.email as student_email,
              'quiz' as grade_type
       FROM grades g
       JOIN quizzes q ON g.quiz_id = q.id
       JOIN activities a ON q.activity_id = a.id
       JOIN courses c ON a.course_id = c.id
       JOIN users u ON g.student_id = u.id
       ORDER BY g.completed_at DESC`
    );

    // Get workshop grades
    const [workshopGrades] = await pool.execute(
      `SELECT wg.id, wg.student_id, wg.workshop_id as quiz_id, wg.score, wg.max_score, 
              wg.percentage, wg.attempt_number, wg.completed_at,
              w.title as quiz_title, a.title as activity_title, c.title as course_title,
              70 as passing_score, u.name as student_name, u.email as student_email,
              'workshop' as grade_type
       FROM workshop_grades wg
       JOIN workshops w ON wg.workshop_id = w.id
       JOIN activities a ON w.activity_id = a.id
       JOIN courses c ON a.course_id = c.id
       JOIN users u ON wg.student_id = u.id
       ORDER BY wg.completed_at DESC`
    );

    // Combine both types of grades
    const allGrades = [...quizGrades, ...workshopGrades].sort((a, b) => 
      new Date(b.completed_at) - new Date(a.completed_at)
    );

    res.json({ grades: allGrades });
  } catch (error) {
    console.error('Get all grades error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/course/{courseId}:
 *   get:
 *     summary: Get grades for all students in a course
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { courseId } = req.params;

    let query = `
      SELECT g.*, u.name as student_name, u.email as student_email,
             q.title as quiz_title, a.title as activity_title,
             q.passing_score
      FROM grades g
      JOIN users u ON g.student_id = u.id
      JOIN quizzes q ON g.quiz_id = q.id
      JOIN activities a ON q.activity_id = a.id
      WHERE a.course_id = ?
    `;

    let params = [courseId];

    // No additional filtering needed for formadors - they can see all students

    query += ' ORDER BY u.name ASC, g.completed_at DESC';

    const [rows] = await pool.execute(query, params);

    res.json({ grades: rows });
  } catch (error) {
    console.error('Get course grades error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/quiz/{quizId}:
 *   get:
 *     summary: Get grades for a specific quiz
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/quiz/:quizId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { quizId } = req.params;

    let query = `
      SELECT g.*, u.name as student_name, u.email as student_email,
             q.title as quiz_title, q.passing_score
      FROM grades g
      JOIN users u ON g.student_id = u.id
      JOIN quizzes q ON g.quiz_id = q.id
      WHERE g.quiz_id = ?
    `;

    let params = [quizId];

    // No additional filtering needed for formadors - they can see all students

    query += ' ORDER BY g.percentage DESC, g.completed_at DESC';

    const [rows] = await pool.execute(query, params);

    res.json({ grades: rows });
  } catch (error) {
    console.error('Get quiz grades error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/summary/{studentId}:
 *   get:
 *     summary: Get grade summary for a student
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/summary/:studentId', auth, authorize('admin', 'formador', 'estudiante'), async (req, res) => {
  try {
    const { studentId } = req.params;

    if (req.user.role === 'estudiante' && req.user.id != studentId) {
      return res.status(403).json({ message: 'You can only view your own grade summary' });
    }

    // Verify that the requested student exists and is actually a student
    if (req.user.role === 'formador' || req.user.role === 'admin') {
      const [studentExists] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND role = "estudiante"',
        [studentId]
      );

      if (studentExists.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
    }

    const [summaryRows] = await pool.execute(
      `SELECT 
         COUNT(*) as total_quizzes_taken,
         AVG(percentage) as average_percentage,
         MIN(percentage) as lowest_percentage,
         MAX(percentage) as highest_percentage,
         SUM(CASE WHEN percentage >= (SELECT passing_score FROM quizzes WHERE id = quiz_id) THEN 1 ELSE 0 END) as quizzes_passed
       FROM grades 
       WHERE student_id = ?`,
      [studentId]
    );

    const [courseProgressRows] = await pool.execute(
      `SELECT c.title as course_title, c.id as course_id,
              COUNT(DISTINCT a.id) as total_activities,
              COUNT(DISTINCT ap.activity_id) as completed_activities,
              COUNT(DISTINCT g.quiz_id) as quizzes_taken,
              AVG(g.percentage) as average_quiz_score
       FROM courses c
       JOIN course_assignments ca ON c.id = ca.course_id
       LEFT JOIN activities a ON c.id = a.course_id
       LEFT JOIN activity_progress ap ON a.id = ap.activity_id AND ap.student_id = ?
       LEFT JOIN quizzes q ON a.id = q.activity_id
       LEFT JOIN grades g ON q.id = g.quiz_id AND g.student_id = ?
       WHERE ca.student_id = ?
       GROUP BY c.id, c.title
       ORDER BY c.title`,
      [studentId, studentId, studentId]
    );

    const summary = summaryRows[0];
    summary.course_progress = courseProgressRows;

    res.json({ summary });
  } catch (error) {
    console.error('Get grade summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/my-courses-progress:
 *   get:
 *     summary: Get student's courses with progress and grades
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-courses-progress', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [coursesData] = await pool.execute(
      `SELECT DISTINCT c.id, c.title, c.description,
              COUNT(DISTINCT a.id) as total_activities,
              COUNT(DISTINCT CASE WHEN ap.completed = 1 THEN a.id END) as completed_content,
              COUNT(DISTINCT q.id) as total_quizzes,
              COUNT(DISTINCT w.id) as total_workshops,
              COUNT(DISTINCT g.id) as completed_quizzes,
              COUNT(DISTINCT wg.id) as completed_workshops,
              AVG(g.percentage) as avg_quiz_score,
              AVG(wg.percentage) as avg_workshop_score,
              COUNT(DISTINCT CASE WHEN g.percentage >= (SELECT passing_score FROM quizzes WHERE id = g.quiz_id) THEN g.id END) as passed_quizzes,
              COUNT(DISTINCT CASE WHEN wg.percentage >= 70 THEN wg.id END) as passed_workshops
       FROM courses c
       INNER JOIN course_assignments ca ON c.id = ca.course_id
       LEFT JOIN activities a ON c.id = a.course_id
       LEFT JOIN activity_progress ap ON a.id = ap.activity_id AND ap.student_id = ?
       LEFT JOIN quizzes q ON a.id = q.activity_id
       LEFT JOIN grades g ON q.id = g.quiz_id AND g.student_id = ?
       LEFT JOIN workshops w ON a.id = w.activity_id
       LEFT JOIN workshop_grades wg ON w.id = wg.workshop_id AND wg.student_id = ?
       WHERE ca.student_id = ?
       GROUP BY c.id, c.title, c.description
       ORDER BY c.title`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );

    // Calculate overall progress for each course
    const coursesWithProgress = coursesData.map(course => {
      // Calculate total components: content + quizzes + workshops
      const totalComponents = (course.total_activities || 0) + (course.total_quizzes || 0) + (course.total_workshops || 0);
      const completedComponents = (course.completed_content || 0) + (course.completed_quizzes || 0) + (course.completed_workshops || 0);
      
      // Progress based on completed components vs total components
      const progressPercentage = totalComponents > 0
        ? Math.round((completedComponents / totalComponents) * 100)
        : 0;
      
      const totalEvaluations = (course.completed_quizzes || 0) + (course.completed_workshops || 0);
      
      // Calculate weighted average score
      let overallScore = 0;
      if (totalEvaluations > 0) {
        const quizWeight = (course.completed_quizzes || 0) / totalEvaluations;
        const workshopWeight = (course.completed_workshops || 0) / totalEvaluations;
        
        overallScore = Math.round(
          ((course.avg_quiz_score || 0) * quizWeight) + 
          ((course.avg_workshop_score || 0) * workshopWeight)
        );
      }

      return {
        ...course,
        progress_percentage: Math.min(progressPercentage, 100),
        overall_score: overallScore,
        total_components: totalComponents,
        completed_components: completedComponents,
        total_evaluations: totalEvaluations,
        passed_evaluations: (course.passed_quizzes || 0) + (course.passed_workshops || 0)
      };
    });

    res.json({ courses: coursesWithProgress });
  } catch (error) {
    console.error('Get my courses progress error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/course/{courseId}/details:
 *   get:
 *     summary: Get detailed grades for a specific course
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId/details', auth, authorize('estudiante'), async (req, res) => {
  try {
    const { courseId } = req.params;
    console.log(`Getting course details for course ${courseId}, student ${req.user.id}`);

    // Get activities with their quizzes and workshops
    const [activitiesData] = await pool.execute(
      `SELECT a.id, a.title, a.description, a.order_index,
              COUNT(DISTINCT q.id) as quiz_count,
              COUNT(DISTINCT w.id) as workshop_count,
              MAX(ap.completed) as is_completed
       FROM activities a
       LEFT JOIN quizzes q ON a.id = q.activity_id
       LEFT JOIN workshops w ON a.id = w.activity_id
       LEFT JOIN activity_progress ap ON a.id = ap.activity_id AND ap.student_id = ?
       WHERE a.course_id = ?
       GROUP BY a.id, a.title, a.description, a.order_index
       ORDER BY a.order_index`,
      [req.user.id, courseId]
    );

    // Get quiz grades for this course
    const [quizGrades] = await pool.execute(
      `SELECT g.*, q.title as quiz_title, q.passing_score, a.id as activity_id, a.title as activity_title
       FROM grades g
       JOIN quizzes q ON g.quiz_id = q.id
       JOIN activities a ON q.activity_id = a.id
       WHERE a.course_id = ? AND g.student_id = ?
       ORDER BY g.completed_at DESC`,
      [courseId, req.user.id]
    );

    // Get workshop grades for this course
    const [workshopGrades] = await pool.execute(
      `SELECT wg.*, w.title as workshop_title, a.id as activity_id, a.title as activity_title
       FROM workshop_grades wg
       JOIN workshops w ON wg.workshop_id = w.id
       JOIN activities a ON w.activity_id = a.id
       WHERE a.course_id = ? AND wg.student_id = ?
       ORDER BY wg.completed_at DESC`,
      [courseId, req.user.id]
    );

    // Organize data by activity
    const activitiesWithGrades = activitiesData.map(activity => {
      const activityQuizGrades = quizGrades.filter(g => g.activity_id === activity.id);
      const activityWorkshopGrades = workshopGrades.filter(g => g.activity_id === activity.id);
      
      // Calculate activity progress: content + quizzes + workshops
      const totalComponents = 1 + activity.quiz_count + activity.workshop_count; // 1 for content
      let completedComponents = activity.is_completed ? 1 : 0; // content completion
      completedComponents += activityQuizGrades.length; // completed quizzes
      completedComponents += activityWorkshopGrades.length; // completed workshops
      
      const activityProgress = totalComponents > 0 ? Math.round((completedComponents / totalComponents) * 100) : 0;
      
      return {
        ...activity,
        quiz_grades: activityQuizGrades,
        workshop_grades: activityWorkshopGrades,
        has_grades: activityQuizGrades.length > 0 || activityWorkshopGrades.length > 0,
        progress_percentage: activityProgress,
        total_components: totalComponents,
        completed_components: completedComponents
      };
    });

    // Calculate averages and overall score
    const avgQuizScore = quizGrades.length > 0 ? Math.round(quizGrades.reduce((sum, g) => sum + g.percentage, 0) / quizGrades.length) : 0;
    const avgWorkshopScore = workshopGrades.length > 0 ? Math.round(workshopGrades.reduce((sum, g) => sum + g.percentage, 0) / workshopGrades.length) : 0;
    
    console.log(`Quiz grades: ${quizGrades.length}, avg: ${avgQuizScore}%`);
    console.log(`Workshop grades: ${workshopGrades.length}, avg: ${avgWorkshopScore}%`);
    
    // Calculate weighted overall score
    const totalEvaluations = quizGrades.length + workshopGrades.length;
    let overallScore = 0;
    
    if (totalEvaluations > 0) {
      const quizWeight = quizGrades.length / totalEvaluations;
      const workshopWeight = workshopGrades.length / totalEvaluations;
      overallScore = Math.round((avgQuizScore * quizWeight) + (avgWorkshopScore * workshopWeight));
      console.log(`Overall score calculated: ${overallScore}% (${totalEvaluations} total evaluations)`);
    } else {
      console.log(`No evaluations found for course ${courseId}`);
    }

    res.json({ 
      activities: activitiesWithGrades,
      summary: {
        total_quiz_grades: quizGrades.length,
        total_workshop_grades: workshopGrades.length,
        avg_quiz_score: avgQuizScore,
        avg_workshop_score: avgWorkshopScore,
        overall_score: overallScore
      }
    });
  } catch (error) {
    console.error('Get course details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/my-formadores:
 *   get:
 *     summary: Get student's assigned formadores
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-formadores', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, sf.assigned_at
       FROM student_formador sf
       JOIN users u ON sf.formador_id = u.id
       WHERE sf.student_id = ?
       ORDER BY sf.assigned_at DESC`,
      [req.user.id]
    );

    res.json({ formadores: rows });
  } catch (error) {
    console.error('Get my formadores error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/student/{studentId}/course/{courseId}/progress:
 *   get:
 *     summary: Get student progress for a specific course
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/student/:studentId/course/:courseId/progress', auth, authorize('admin', 'formador', 'estudiante'), async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    // Students can only view their own progress
    if (req.user.role === 'estudiante' && req.user.id != studentId) {
      return res.status(403).json({ message: 'You can only view your own progress' });
    }

    // Verify that the requested student exists and is actually a student
    if (req.user.role === 'formador' || req.user.role === 'admin') {
      const [studentExists] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND role = "estudiante"',
        [studentId]
      );

      if (studentExists.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
    }

    // Get basic progress data - this is a simple implementation
    // You could extend this with more detailed progress tracking
    const [progressRows] = await pool.execute(
      `SELECT 
         COUNT(DISTINCT a.id) as total_activities,
         COUNT(DISTINCT g.id) as completed_quizzes,
         AVG(g.percentage) as average_score
       FROM activities a
       LEFT JOIN quizzes q ON a.id = q.activity_id
       LEFT JOIN grades g ON q.id = g.quiz_id AND g.student_id = ?
       WHERE a.course_id = ?`,
      [studentId, courseId]
    );

    const progress = progressRows[0] || {
      total_activities: 0,
      completed_quizzes: 0,
      average_score: 0
    };

    res.json({ progress });
  } catch (error) {
    console.error('Get student progress error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/overall-stats:
 *   get:
 *     summary: Get overall statistics (admin only)
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 */
router.get('/overall-stats', auth, authorize('admin'), async (req, res) => {
  try {
    const [generalStats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT u.id) as total_students,
        COUNT(DISTINCT c.id) as total_courses,
        COUNT(DISTINCT q.id) as total_quizzes,
        COUNT(DISTINCT g.id) as total_quiz_attempts,
        AVG(g.percentage) as overall_average_score
      FROM users u
      LEFT JOIN course_assignments ca ON u.id = ca.student_id
      LEFT JOIN courses c ON ca.course_id = c.id
      LEFT JOIN activities a ON c.id = a.course_id
      LEFT JOIN quizzes q ON a.id = q.activity_id
      LEFT JOIN grades g ON q.id = g.quiz_id
      WHERE u.role = 'estudiante'
    `);

    const [courseStats] = await pool.execute(`
      SELECT c.title as course_title,
             COUNT(DISTINCT ca.student_id) as enrolled_students,
             COUNT(DISTINCT g.id) as quiz_attempts,
             AVG(g.percentage) as average_score
      FROM courses c
      LEFT JOIN course_assignments ca ON c.id = ca.course_id
      LEFT JOIN activities a ON c.id = a.course_id
      LEFT JOIN quizzes q ON a.id = q.activity_id
      LEFT JOIN grades g ON q.id = g.quiz_id
      GROUP BY c.id, c.title
      ORDER BY enrolled_students DESC
    `);

    res.json({ 
      general: generalStats[0],
      courses: courseStats 
    });
  } catch (error) {
    console.error('Get overall stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/grades/audit/{gradeId}:
 *   get:
 *     summary: Audit specific grade - compare student answers vs correct answers
 *     tags: [Grades]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: gradeId
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/audit/:gradeId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { gradeId } = req.params;
    console.log('Audit request for gradeId:', gradeId);

    // Get grade with student answers
    const [gradeRows] = await pool.execute(
      `SELECT g.*, u.name as student_name, u.email as student_email, 
              q.title as quiz_title, q.passing_score
       FROM grades g
       JOIN users u ON g.student_id = u.id
       JOIN quizzes q ON g.quiz_id = q.id
       WHERE g.id = ?`,
      [gradeId]
    );

    if (gradeRows.length === 0) {
      console.log('No grade found for ID:', gradeId);
      return res.status(404).json({ message: 'Grade not found' });
    }

    const grade = gradeRows[0];
    console.log('Grade found:', grade);

    // Get quiz questions with correct answers
    const [questionsRows] = await pool.execute(
      `SELECT id, question, options, correct_answer, points
       FROM quiz_questions
       WHERE quiz_id = ?
       ORDER BY order_index`,
      [grade.quiz_id]
    );

    // Parse student answers
    let studentAnswers = {};
    try {
      if (grade.student_answers) {
        // If it's already an object (MySQL2 auto-parsing), use it directly
        if (typeof grade.student_answers === 'object') {
          studentAnswers = grade.student_answers;
        } else {
          // If it's a string, parse it
          studentAnswers = JSON.parse(grade.student_answers);
        }
      }
    } catch (error) {
      console.log('Error parsing student_answers:', error);
      studentAnswers = {};
    }

    // Compare answers
    const auditResults = questionsRows.map(question => {
      const studentAnswer = studentAnswers[question.id];
      // Convert both to numbers for proper comparison
      const studentAnswerInt = parseInt(studentAnswer);
      const correctAnswerInt = parseInt(question.correct_answer);
      const isCorrect = studentAnswerInt === correctAnswerInt;
      const pointsEarned = isCorrect ? question.points : 0;

      return {
        question_id: question.id,
        question: question.question,
        options: question.options,
        correct_answer: question.correct_answer,
        student_answer: studentAnswer,
        is_correct: isCorrect,
        points_possible: question.points,
        points_earned: pointsEarned
      };
    });

    // Calculate totals
    const totalPointsEarned = auditResults.reduce((sum, q) => sum + q.points_earned, 0);
    const totalPointsPossible = auditResults.reduce((sum, q) => sum + q.points_possible, 0);
    const calculatedPercentage = Math.round((totalPointsEarned / totalPointsPossible) * 100);

    res.json({
      grade: {
        id: grade.id,
        student_name: grade.student_name,
        student_email: grade.student_email,
        quiz_title: grade.quiz_title,
        passing_score: grade.passing_score,
        attempt_number: grade.attempt_number,
        completed_at: grade.completed_at
      },
      stored_results: {
        score: grade.score,
        max_score: grade.max_score,
        percentage: grade.percentage
      },
      calculated_results: {
        score: totalPointsEarned,
        max_score: totalPointsPossible,
        percentage: calculatedPercentage
      },
      is_calculation_correct: grade.percentage == calculatedPercentage,
      questions_audit: auditResults,
      summary: {
        total_questions: questionsRows.length,
        correct_answers: auditResults.filter(q => q.is_correct).length,
        incorrect_answers: auditResults.filter(q => !q.is_correct).length,
        unanswered: auditResults.filter(q => q.student_answer === undefined).length
      }
    });

  } catch (error) {
    console.error('Audit grade error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;