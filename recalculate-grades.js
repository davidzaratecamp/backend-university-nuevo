const { pool } = require('./config/database');
require('dotenv').config();

async function recalculateAllGrades() {
  try {
    console.log('🔄 Iniciando recálculo de calificaciones...');

    // Get all grades that have student answers
    const [grades] = await pool.execute(
      `SELECT g.id, g.student_id, g.quiz_id, g.student_answers, g.score as old_score, g.percentage as old_percentage,
              u.name as student_name, q.title as quiz_title
       FROM grades g 
       JOIN users u ON g.student_id = u.id 
       JOIN quizzes q ON g.quiz_id = q.id 
       WHERE g.student_answers IS NOT NULL`
    );

    console.log(`📊 Encontradas ${grades.length} calificaciones para recalcular`);

    let corrected = 0;
    let errors = 0;

    for (const grade of grades) {
      try {
        // Get quiz questions
        const [questions] = await pool.execute(
          `SELECT id, question, correct_answer, points
           FROM quiz_questions 
           WHERE quiz_id = ? 
           ORDER BY order_index`,
          [grade.quiz_id]
        );

        // Parse student answers
        let studentAnswers = {};
        try {
          if (typeof grade.student_answers === 'object') {
            studentAnswers = grade.student_answers;
          } else {
            studentAnswers = JSON.parse(grade.student_answers);
          }
        } catch (parseError) {
          console.error(`❌ Error parsing answers for grade ${grade.id}:`, parseError);
          errors++;
          continue;
        }

        // Recalculate score
        let correctAnswers = 0;
        let totalPoints = 0;

        questions.forEach(question => {
          totalPoints += question.points;
          const studentAnswer = studentAnswers[question.id];
          
          // Convert both to numbers for proper comparison
          const studentAnswerInt = parseInt(studentAnswer);
          const correctAnswerInt = parseInt(question.correct_answer);
          
          if (studentAnswerInt === correctAnswerInt) {
            correctAnswers += question.points;
          }
        });

        const newPercentage = Math.round((correctAnswers / totalPoints) * 100);

        // Check if there's a difference
        if (correctAnswers !== parseFloat(grade.old_score) || newPercentage !== parseFloat(grade.old_percentage)) {
          // Update the grade
          await pool.execute(
            `UPDATE grades 
             SET score = ?, percentage = ? 
             WHERE id = ?`,
            [correctAnswers, newPercentage, grade.id]
          );

          console.log(`✅ Corregida calificación ID ${grade.id}:`);
          console.log(`   👤 Estudiante: ${grade.student_name}`);
          console.log(`   📝 Quiz: ${grade.quiz_title}`);
          console.log(`   📊 Antes: ${grade.old_score}/${totalPoints} (${grade.old_percentage}%)`);
          console.log(`   📊 Después: ${correctAnswers}/${totalPoints} (${newPercentage}%)`);
          console.log('');

          corrected++;
        }

      } catch (gradeError) {
        console.error(`❌ Error procesando calificación ${grade.id}:`, gradeError);
        errors++;
      }
    }

    console.log('🏁 Recálculo completado:');
    console.log(`   ✅ Calificaciones corregidas: ${corrected}`);
    console.log(`   ❌ Errores: ${errors}`);
    console.log(`   📊 Total procesadas: ${grades.length}`);

  } catch (error) {
    console.error('💥 Error general en el recálculo:', error);
  } finally {
    process.exit(0);
  }
}

// Ejecutar el script
recalculateAllGrades();