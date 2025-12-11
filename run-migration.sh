#!/bin/bash

# Script para aplicar la migración de opciones de texto en workshop_questions
# Ejecutar este script después de iniciar el servidor MySQL

echo "Aplicando migración para agregar campos de texto a workshop_questions..."

# Verificar que MySQL esté corriendo
if ! pgrep mysql > /dev/null; then
    echo "Error: MySQL no está corriendo. Inicia MySQL primero."
    exit 1
fi

# Aplicar migración
mysql -u root -p -e "USE new_asisteuniversity; $(cat add-text-options-migration.sql)"

if [ $? -eq 0 ]; then
    echo "✅ Migración aplicada exitosamente"
    echo "Los talleres ahora soportan opciones de texto además de imágenes"
else
    echo "❌ Error al aplicar migración"
    exit 1
fi