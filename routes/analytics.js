const express = require('express');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Get dashboard analytics data
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 */
router.get('/dashboard', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    // Get total users by role
    const [usersByRole] = await pool.execute(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role
    `);

    // Get total courses and activities
    const [coursesData] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT c.id) as total_courses,
        COUNT(DISTINCT a.id) as total_activities,
        COUNT(DISTINCT w.id) as total_workshops,
        COUNT(DISTINCT q.id) as total_quizzes
      FROM courses c
      LEFT JOIN activities a ON c.id = a.course_id
      LEFT JOIN workshops w ON a.id = w.activity_id
      LEFT JOIN quizzes q ON a.id = q.activity_id
    `);

    // Get enrollment statistics
    const [enrollmentStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_enrollments,
        COUNT(DISTINCT student_id) as unique_students,
        COUNT(DISTINCT course_id) as courses_with_students
      FROM course_assignments
    `);

    // Get average grades
    const [gradesStats] = await pool.execute(`
      SELECT 
        AVG(percentage) as avg_quiz_grade,
        COUNT(DISTINCT student_id) as students_with_grades,
        COUNT(*) as total_quiz_attempts
      FROM grades
    `);

    const [workshopGradesStats] = await pool.execute(`
      SELECT 
        AVG(percentage) as avg_workshop_grade,
        COUNT(DISTINCT student_id) as students_with_workshop_grades,
        COUNT(*) as total_workshop_attempts
      FROM workshop_grades
    `);

    // Get grades distribution
    const [gradesDistribution] = await pool.execute(`
      SELECT 
        CASE 
          WHEN percentage >= 90 THEN 'Excelente (90-100)'
          WHEN percentage >= 80 THEN 'Muy Bueno (80-89)'
          WHEN percentage >= 70 THEN 'Bueno (70-79)'
          WHEN percentage >= 60 THEN 'Aceptable (60-69)'
          ELSE 'Necesita Mejorar (<60)'
        END as grade_range,
        COUNT(*) as count
      FROM (
        SELECT percentage FROM grades
        UNION ALL
        SELECT percentage FROM workshop_grades
      ) all_grades
      GROUP BY grade_range
      ORDER BY MIN(percentage) DESC
    `);

    // Get monthly student registration trend (last 6 months)
    const [enrollmentTrend] = await pool.execute(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as enrollments
      FROM users
      WHERE role = 'estudiante' AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month ASC
    `);

    // Get satisfaction statistics (course surveys)
    const [satisfactionStats] = await pool.execute(`
      SELECT
        AVG(overall_rating) as avg_overall,
        AVG(content_quality) as avg_content,
        AVG(instructor_rating) as avg_instructor,
        AVG(difficulty_level) as avg_difficulty,
        COUNT(*) as total_surveys,
        SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) as would_recommend_count
      FROM satisfaction_surveys
    `);

    // Get general satisfaction statistics (student overall experience)
    const [generalSatisfactionStats] = await pool.execute(`
      SELECT
        AVG(content_quality) as avg_content_quality,
        AVG(formador_support) as avg_formador_support,
        AVG(platform_usability) as avg_platform_usability,
        AVG(time_management) as avg_time_management,
        AVG(overall_experience) as avg_overall_experience,
        COUNT(*) as total_surveys,
        SUM(CASE WHEN would_recommend = 1 THEN 1 ELSE 0 END) as would_recommend_count
      FROM general_satisfaction_surveys
    `);

    // Get satisfaction trends over time (general surveys)
    const [satisfactionTrend] = await pool.execute(`
      SELECT
        DATE_FORMAT(submitted_at, '%Y-%m') as month,
        AVG(overall_experience) as avg_experience,
        COUNT(*) as survey_count
      FROM general_satisfaction_surveys
      WHERE submitted_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(submitted_at, '%Y-%m')
      ORDER BY month ASC
    `);

    // Get course completion rates
    const [completionRates] = await pool.execute(`
      SELECT 
        c.id,
        c.title,
        COUNT(DISTINCT ca.student_id) as enrolled_students,
        COUNT(DISTINCT ap.student_id) as students_with_progress,
        ROUND((COUNT(DISTINCT ap.student_id) / NULLIF(COUNT(DISTINCT ca.student_id), 0)) * 100, 2) as completion_rate
      FROM courses c
      LEFT JOIN course_assignments ca ON c.id = ca.course_id
      LEFT JOIN activities a ON c.id = a.course_id
      LEFT JOIN activity_progress ap ON a.id = ap.activity_id AND ap.completed = 1
      GROUP BY c.id, c.title
      HAVING enrolled_students > 0
      ORDER BY completion_rate DESC
      LIMIT 10
    `);

    // Get top performing students
    const [topStudents] = await pool.execute(`
      SELECT 
        u.id,
        u.name,
        ROUND(AVG(g.percentage), 2) as avg_grade,
        COUNT(DISTINCT g.quiz_id) as quizzes_taken,
        COUNT(DISTINCT wg.workshop_id) as workshops_taken
      FROM users u
      LEFT JOIN grades g ON u.id = g.student_id
      LEFT JOIN workshop_grades wg ON u.id = wg.student_id
      WHERE u.role = 'estudiante'
      GROUP BY u.id, u.name
      HAVING quizzes_taken > 0 OR workshops_taken > 0
      ORDER BY avg_grade DESC
      LIMIT 10
    `);

    // Get activity by day of week
    const [activityByDay] = await pool.execute(`
      SELECT 
        DAYNAME(completed_at) as day_name,
        COUNT(*) as count
      FROM (
        SELECT completed_at FROM grades
        UNION ALL
        SELECT completed_at FROM workshop_grades
      ) all_completions
      WHERE completed_at IS NOT NULL
      GROUP BY DAYNAME(completed_at), DAYOFWEEK(completed_at)
      ORDER BY DAYOFWEEK(completed_at)
    `);

    res.json({
      usersByRole,
      coursesData: coursesData[0],
      enrollmentStats: enrollmentStats[0],
      gradesStats: {
        quizzes: gradesStats[0],
        workshops: workshopGradesStats[0]
      },
      gradesDistribution,
      enrollmentTrend,
      satisfactionStats: satisfactionStats[0],
      generalSatisfactionStats: generalSatisfactionStats[0],
      satisfactionTrend,
      completionRates,
      topStudents,
      activityByDay
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
