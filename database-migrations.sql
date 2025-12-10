-- Migraciones para corregir sistema de auditoría de calificaciones
-- Ejecutar estos comandos en la base de datos de producción

-- 1. Agregar campo student_answers a la tabla grades
ALTER TABLE grades ADD COLUMN student_answers JSON DEFAULT NULL AFTER percentage;

-- 2. Agregar campo student_answers a la tabla workshop_grades  
ALTER TABLE workshop_grades ADD COLUMN student_answers JSON DEFAULT NULL AFTER percentage;

-- 3. Verificar que las columnas fueron agregadas correctamente
-- DESCRIBE grades;
-- DESCRIBE workshop_grades;

-- Nota: Estos cambios permiten almacenar las respuestas de los estudiantes
-- para auditoria y recálculo de calificaciones en caso de errores.
-- El campo JSON es compatible con MySQL 5.7+ y MariaDB 10.2+