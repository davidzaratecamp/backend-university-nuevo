const express = require('express');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/satisfaction:
 *   post:
 *     summary: Submit satisfaction survey
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', auth, authorize('estudiante'), async (req, res) => {
  try {
    const { 
      course_id, 
      overall_rating, 
      content_quality, 
      instructor_rating, 
      difficulty_level, 
      comments, 
      would_recommend 
    } = req.body;

    if (!course_id || !overall_rating || !content_quality || !instructor_rating || !difficulty_level) {
      return res.status(400).json({ 
        message: 'Course ID and all rating fields are required' 
      });
    }

    if (![1,2,3,4,5].includes(overall_rating) || 
        ![1,2,3,4,5].includes(content_quality) ||
        ![1,2,3,4,5].includes(instructor_rating) ||
        ![1,2,3,4,5].includes(difficulty_level)) {
      return res.status(400).json({ 
        message: 'All ratings must be between 1 and 5' 
      });
    }

    const [assignmentRows] = await pool.execute(
      'SELECT id FROM course_assignments WHERE course_id = ? AND student_id = ?',
      [course_id, req.user.id]
    );

    if (assignmentRows.length === 0) {
      return res.status(403).json({ 
        message: 'You can only submit surveys for courses you are assigned to' 
      });
    }

    try {
      await pool.execute(
        `INSERT INTO satisfaction_surveys 
         (student_id, course_id, overall_rating, content_quality, instructor_rating, 
          difficulty_level, comments, would_recommend) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         overall_rating = VALUES(overall_rating),
         content_quality = VALUES(content_quality),
         instructor_rating = VALUES(instructor_rating),
         difficulty_level = VALUES(difficulty_level),
         comments = VALUES(comments),
         would_recommend = VALUES(would_recommend),
         submitted_at = CURRENT_TIMESTAMP`,
        [
          req.user.id, 
          course_id, 
          overall_rating, 
          content_quality, 
          instructor_rating, 
          difficulty_level, 
          comments || '', 
          would_recommend !== false
        ]
      );

      res.json({ message: 'Satisfaction survey submitted successfully' });
    } catch (error) {
      console.error('Survey submission error:', error);
      res.status(500).json({ message: 'Error submitting survey' });
    }
  } catch (error) {
    console.error('Submit satisfaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/my-surveys:
 *   get:
 *     summary: Get student's submitted surveys
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
/**
 * @swagger
 * /api/satisfaction/{id}:
 *   put:
 *     summary: Update satisfaction survey
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', auth, authorize('estudiante'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      overall_rating, 
      content_quality, 
      instructor_rating, 
      difficulty_level, 
      comments, 
      would_recommend 
    } = req.body;

    // Verify the survey belongs to the student
    const [surveyRows] = await pool.execute(
      'SELECT student_id FROM satisfaction_surveys WHERE id = ?',
      [id]
    );

    if (surveyRows.length === 0) {
      return res.status(404).json({ message: 'Survey not found' });
    }

    if (surveyRows[0].student_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own surveys' });
    }

    await pool.execute(
      `UPDATE satisfaction_surveys 
       SET overall_rating = ?, content_quality = ?, instructor_rating = ?, 
           difficulty_level = ?, comments = ?, would_recommend = ?, 
           submitted_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [overall_rating, content_quality, instructor_rating, difficulty_level, 
       comments || '', would_recommend !== false, id]
    );

    res.json({ message: 'Survey updated successfully' });
  } catch (error) {
    console.error('Update satisfaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/course/{courseId}/student/{studentId}:
 *   get:
 *     summary: Get survey by course and student
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId/student/:studentId', auth, async (req, res) => {
  try {
    const { courseId, studentId } = req.params;

    // Students can only access their own surveys
    if (req.user.role === 'estudiante' && req.user.id != studentId) {
      return res.status(403).json({ message: 'You can only access your own surveys' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM satisfaction_surveys WHERE course_id = ? AND student_id = ?',
      [courseId, studentId]
    );

    res.json({ survey: rows[0] || null });
  } catch (error) {
    console.error('Get survey error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/my-surveys', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ss.*, c.title as course_title
       FROM satisfaction_surveys ss
       JOIN courses c ON ss.course_id = c.id
       WHERE ss.student_id = ?
       ORDER BY ss.submitted_at DESC`,
      [req.user.id]
    );

    res.json({ surveys: rows });
  } catch (error) {
    console.error('Get my surveys error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/student/{studentId}/surveys:
 *   get:
 *     summary: Get all surveys by student (admin only)
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/student/:studentId/surveys', auth, authorize('admin'), async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get course-specific satisfaction surveys
    const [courseSurveys] = await pool.execute(
      `SELECT ss.*, c.title as course_title, u.name as student_name, u.email as student_email,
              'course' as survey_type
       FROM satisfaction_surveys ss
       JOIN courses c ON ss.course_id = c.id
       JOIN users u ON ss.student_id = u.id
       WHERE ss.student_id = ?
       ORDER BY ss.submitted_at DESC`,
      [studentId]
    );

    // Get general satisfaction surveys
    const [generalSurveys] = await pool.execute(
      `SELECT gss.*, u.name as student_name, u.email as student_email,
              'general' as survey_type, 'Encuesta General de Satisfacción' as course_title
       FROM general_satisfaction_surveys gss
       JOIN users u ON gss.student_id = u.id
       WHERE gss.student_id = ?
       ORDER BY gss.submitted_at DESC`,
      [studentId]
    );

    // Combine both types of surveys
    const allSurveys = [...courseSurveys, ...generalSurveys].sort((a, b) => 
      new Date(b.submitted_at) - new Date(a.submitted_at)
    );

    res.json({ surveys: allSurveys, student_id: studentId });
  } catch (error) {
    console.error('Get student surveys error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/course/{courseId}:
 *   get:
 *     summary: Get satisfaction surveys for a course
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { courseId } = req.params;

    let query = `
      SELECT ss.*, u.name as student_name, u.email as student_email,
             c.title as course_title
      FROM satisfaction_surveys ss
      JOIN users u ON ss.student_id = u.id
      JOIN courses c ON ss.course_id = c.id
      WHERE ss.course_id = ?
    `;

    let params = [courseId];

    if (req.user.role === 'formador') {
      query += ' AND ss.student_id IN (SELECT student_id FROM student_formador WHERE formador_id = ?)';
      params.push(req.user.id);
    }

    query += ' ORDER BY ss.submitted_at DESC';

    const [rows] = await pool.execute(query, params);

    res.json({ surveys: rows });
  } catch (error) {
    console.error('Get course satisfaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/course/{courseId}/summary:
 *   get:
 *     summary: Get satisfaction summary for a course
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId/summary', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { courseId } = req.params;

    let query = `
      SELECT 
        COUNT(*) as total_responses,
        AVG(overall_rating) as avg_overall_rating,
        AVG(content_quality) as avg_content_quality,
        AVG(instructor_rating) as avg_instructor_rating,
        AVG(difficulty_level) as avg_difficulty_level,
        SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) as would_recommend_count,
        SUM(CASE WHEN overall_rating >= 4 THEN 1 ELSE 0 END) as satisfied_count
      FROM satisfaction_surveys ss
      WHERE ss.course_id = ?
    `;

    let params = [courseId];

    if (req.user.role === 'formador') {
      query += ' AND ss.student_id IN (SELECT student_id FROM student_formador WHERE formador_id = ?)';
      params.push(req.user.id);
    }

    const [summaryRows] = await pool.execute(query, params);

    let ratingDistributionQuery = `
      SELECT 
        overall_rating,
        COUNT(*) as count
      FROM satisfaction_surveys ss
      WHERE ss.course_id = ?
    `;

    if (req.user.role === 'formador') {
      ratingDistributionQuery += ' AND ss.student_id IN (SELECT student_id FROM student_formador WHERE formador_id = ?)';
    }

    ratingDistributionQuery += ' GROUP BY overall_rating ORDER BY overall_rating';

    const [distributionRows] = await pool.execute(ratingDistributionQuery, params);

    const summary = summaryRows[0];
    summary.rating_distribution = distributionRows;
    
    if (summary.total_responses > 0) {
      summary.satisfaction_percentage = Math.round((summary.satisfied_count / summary.total_responses) * 100);
      summary.recommendation_percentage = Math.round((summary.would_recommend_count / summary.total_responses) * 100);
    } else {
      summary.satisfaction_percentage = 0;
      summary.recommendation_percentage = 0;
    }

    res.json({ summary });
  } catch (error) {
    console.error('Get satisfaction summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/overall-summary:
 *   get:
 *     summary: Get overall satisfaction summary (admin only)
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/overall-summary', auth, authorize('admin'), async (req, res) => {
  try {
    const [overallSummary] = await pool.execute(`
      SELECT 
        COUNT(*) as total_responses,
        AVG(overall_rating) as avg_overall_rating,
        AVG(content_quality) as avg_content_quality,
        AVG(instructor_rating) as avg_instructor_rating,
        AVG(difficulty_level) as avg_difficulty_level,
        SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) as would_recommend_count,
        SUM(CASE WHEN overall_rating >= 4 THEN 1 ELSE 0 END) as satisfied_count
      FROM satisfaction_surveys
    `);

    const [courseSummary] = await pool.execute(`
      SELECT 
        c.title as course_title,
        COUNT(ss.id) as response_count,
        AVG(ss.overall_rating) as avg_rating,
        SUM(CASE WHEN ss.overall_rating >= 4 THEN 1 ELSE 0 END) as satisfied_count
      FROM courses c
      LEFT JOIN satisfaction_surveys ss ON c.id = ss.course_id
      GROUP BY c.id, c.title
      HAVING response_count > 0
      ORDER BY avg_rating DESC
    `);

    const summary = overallSummary[0];
    summary.course_summaries = courseSummary;
    
    if (summary.total_responses > 0) {
      summary.satisfaction_percentage = Math.round((summary.satisfied_count / summary.total_responses) * 100);
      summary.recommendation_percentage = Math.round((summary.would_recommend_count / summary.total_responses) * 100);
    } else {
      summary.satisfaction_percentage = 0;
      summary.recommendation_percentage = 0;
    }

    res.json({ summary });
  } catch (error) {
    console.error('Get overall satisfaction summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/course/{courseId}/check:
 *   get:
 *     summary: Check if student has submitted survey for course
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/course/:courseId/check', auth, authorize('estudiante'), async (req, res) => {
  try {
    const { courseId } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, submitted_at FROM satisfaction_surveys WHERE student_id = ? AND course_id = ?',
      [req.user.id, courseId]
    );

    res.json({ 
      has_submitted: rows.length > 0,
      survey: rows.length > 0 ? rows[0] : null
    });
  } catch (error) {
    console.error('Check satisfaction survey error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/general:
 *   post:
 *     summary: Submit general satisfaction survey
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.post('/general', auth, authorize('estudiante'), async (req, res) => {
  try {
    const { 
      overall_experience, 
      content_quality, 
      platform_usability, 
      formador_support, 
      time_management,
      would_recommend,
      comments,
      suggestions
    } = req.body;

    if (!overall_experience || !content_quality || !platform_usability || !formador_support || !time_management) {
      return res.status(400).json({ 
        message: 'All rating fields are required' 
      });
    }

    if (![1,2,3,4,5].includes(overall_experience) || 
        ![1,2,3,4,5].includes(content_quality) ||
        ![1,2,3,4,5].includes(platform_usability) ||
        ![1,2,3,4,5].includes(formador_support) ||
        ![1,2,3,4,5].includes(time_management)) {
      return res.status(400).json({ 
        message: 'All ratings must be between 1 and 5' 
      });
    }

    try {
      await pool.execute(
        `INSERT INTO general_satisfaction_surveys 
         (student_id, overall_experience, content_quality, platform_usability, 
          formador_support, time_management, would_recommend, comments, suggestions) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         overall_experience = VALUES(overall_experience),
         content_quality = VALUES(content_quality),
         platform_usability = VALUES(platform_usability),
         formador_support = VALUES(formador_support),
         time_management = VALUES(time_management),
         would_recommend = VALUES(would_recommend),
         comments = VALUES(comments),
         suggestions = VALUES(suggestions),
         submitted_at = CURRENT_TIMESTAMP`,
        [
          req.user.id, 
          overall_experience, 
          content_quality, 
          platform_usability, 
          formador_support,
          time_management,
          would_recommend !== false,
          comments || '',
          suggestions || ''
        ]
      );

      res.json({ message: 'General satisfaction survey submitted successfully' });
    } catch (error) {
      console.error('General survey submission error:', error);
      res.status(500).json({ message: 'Error submitting survey' });
    }
  } catch (error) {
    console.error('Submit general satisfaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/general/check:
 *   get:
 *     summary: Check if student has submitted general survey
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/general/check', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, submitted_at FROM general_satisfaction_surveys WHERE student_id = ?',
      [req.user.id]
    );

    res.json({ 
      has_submitted: rows.length > 0,
      survey: rows.length > 0 ? rows[0] : null
    });
  } catch (error) {
    console.error('Check general satisfaction survey error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/general/my-survey:
 *   get:
 *     summary: Get student's general satisfaction survey
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/general/my-survey', auth, authorize('estudiante'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM general_satisfaction_surveys WHERE student_id = ?',
      [req.user.id]
    );

    res.json({ survey: rows[0] || null });
  } catch (error) {
    console.error('Get my general survey error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/satisfaction/all-surveys:
 *   get:
 *     summary: Get all satisfaction surveys with student and course details (admin only)
 *     tags: [Satisfaction]
 *     security:
 *       - bearerAuth: []
 */
router.get('/all-surveys', auth, authorize('admin'), async (req, res) => {
  try {
    // Get course-specific satisfaction surveys
    const [courseSurveys] = await pool.execute(`
      SELECT 
        ss.id,
        ss.student_id,
        ss.course_id,
        ss.overall_rating,
        ss.content_quality,
        ss.instructor_rating,
        ss.difficulty_level,
        ss.comments,
        ss.would_recommend,
        ss.submitted_at,
        u.name as student_name,
        u.email as student_email,
        c.title as course_title,
        'course' as survey_type
      FROM satisfaction_surveys ss
      JOIN users u ON ss.student_id = u.id
      JOIN courses c ON ss.course_id = c.id
      ORDER BY ss.submitted_at DESC
    `);

    // Get general satisfaction surveys  
    const [generalSurveys] = await pool.execute(`
      SELECT 
        gss.id,
        gss.student_id,
        NULL as course_id,
        gss.overall_experience as overall_rating,
        gss.content_quality,
        NULL as instructor_rating,
        NULL as difficulty_level,
        gss.comments,
        gss.would_recommend,
        gss.submitted_at,
        u.name as student_name,
        u.email as student_email,
        'Encuesta General de Satisfacción' as course_title,
        'general' as survey_type
      FROM general_satisfaction_surveys gss
      JOIN users u ON gss.student_id = u.id
      ORDER BY gss.submitted_at DESC
    `);

    // Combine both types of surveys and sort by date
    const allSurveys = [...courseSurveys, ...generalSurveys].sort((a, b) => 
      new Date(b.submitted_at) - new Date(a.submitted_at)
    );

    res.json({ surveys: allSurveys });
  } catch (error) {
    console.error('Get all surveys error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;