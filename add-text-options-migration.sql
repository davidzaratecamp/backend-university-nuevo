-- Migration to add text options to workshop_questions table
-- This allows questions to have either text or image options (or both)

ALTER TABLE workshop_questions 
ADD COLUMN option_a_text TEXT AFTER option_d_image,
ADD COLUMN option_b_text TEXT AFTER option_a_text,
ADD COLUMN option_c_text TEXT AFTER option_b_text,
ADD COLUMN option_d_text TEXT AFTER option_c_text;

-- Update the table comment to reflect the new structure
ALTER TABLE workshop_questions COMMENT = 'Workshop questions with support for both text and image options';