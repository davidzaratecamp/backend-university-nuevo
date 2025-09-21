const express = require('express');
const { pool } = require('../config/database');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/forum/posts:
 *   get:
 *     summary: Get forum posts visible to the user
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.get('/posts', auth, async (req, res) => {
  try {
    let query = '';
    let params = [];

    if (req.user.role === 'admin') {
      // Admin puede ver todos los posts
      query = `
        SELECT p.*, u.name as author_name, u.profile_image as author_image,
               COUNT(c.id) as comment_count
        FROM forum_posts p
        JOIN users u ON p.author_id = u.id
        LEFT JOIN forum_comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
    } else if (req.user.role === 'formador') {
      // Formador puede ver todos los posts (los suyos y de otros formadores)
      query = `
        SELECT p.*, u.name as author_name, u.profile_image as author_image,
               COUNT(c.id) as comment_count
        FROM forum_posts p
        JOIN users u ON p.author_id = u.id
        LEFT JOIN forum_comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
    } else if (req.user.role === 'estudiante') {
      // Estudiante solo puede ver posts de formadores que enseñan sus cursos
      query = `
        SELECT DISTINCT p.*, u.name as author_name, u.profile_image as author_image,
               COUNT(c.id) as comment_count
        FROM forum_posts p
        JOIN users u ON p.author_id = u.id
        JOIN formador_courses fc ON u.id = fc.formador_id
        JOIN course_assignments ca ON fc.course_id = ca.course_id
        LEFT JOIN forum_comments c ON p.id = c.post_id
        WHERE ca.student_id = ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
      params = [req.user.id];
    }

    const [rows] = await pool.execute(query, params);
    res.json({ posts: rows });
  } catch (error) {
    console.error('Get forum posts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/posts:
 *   post:
 *     summary: Create a new forum post (formadores and admin only)
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.post('/posts', auth, authorize('admin', 'formador'), async (req, res) => {
  try {
    const { title, content, image_url } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'Título y contenido son requeridos' });
    }

    const [result] = await pool.execute(
      'INSERT INTO forum_posts (title, content, image_url, author_id) VALUES (?, ?, ?, ?)',
      [title, content, image_url || null, req.user.id]
    );

    // Crear notificaciones para estudiantes que pueden ver el post
    if (req.user.role === 'formador') {
      const [students] = await pool.execute(
        `SELECT DISTINCT ca.student_id, u.name as student_name
         FROM course_assignments ca
         JOIN formador_courses fc ON ca.course_id = fc.course_id
         JOIN users u ON ca.student_id = u.id
         WHERE fc.formador_id = ?`,
        [req.user.id]
      );

      for (const student of students) {
        await pool.execute(
          'INSERT INTO forum_notifications (user_id, type, related_post_id, message) VALUES (?, ?, ?, ?)',
          [student.student_id, 'new_post', result.insertId, `${req.user.name} creó una nueva publicación en el foro`]
        );

        // Send real-time notification
        if (global.io) {
          global.io.to(`user-${student.student_id}`).emit('new-notification', {
            type: 'new_post',
            message: `${req.user.name} creó una nueva publicación en el foro`,
            post_id: result.insertId
          });
        }
      }
    }

    res.status(201).json({
      message: 'Post creado exitosamente',
      postId: result.insertId
    });
  } catch (error) {
    console.error('Create forum post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/posts/{id}:
 *   get:
 *     summary: Get a specific forum post with its comments
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.get('/posts/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener el post
    const [postRows] = await pool.execute(
      `SELECT p.*, u.name as author_name, u.profile_image as author_image
       FROM forum_posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (postRows.length === 0) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    const post = postRows[0];

    // Verificar permisos de visibilidad
    if (req.user.role === 'estudiante') {
      // Verificar que el estudiante pueda ver este post
      const [accessRows] = await pool.execute(
        `SELECT 1 FROM formador_courses fc
         JOIN course_assignments ca ON fc.course_id = ca.course_id
         WHERE fc.formador_id = ? AND ca.student_id = ?`,
        [post.author_id, req.user.id]
      );

      if (accessRows.length === 0) {
        return res.status(403).json({ message: 'No tienes permiso para ver este post' });
      }
    }

    // Obtener comentarios organizados jerárquicamente
    const [commentRows] = await pool.execute(
      `SELECT c.*, u.name as author_name, u.profile_image as author_image
       FROM forum_comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`,
      [id]
    );

    // Organizar comentarios en estructura jerárquica
    const commentsMap = new Map();
    const rootComments = [];

    commentRows.forEach(comment => {
      comment.replies = [];
      commentsMap.set(comment.id, comment);

      if (comment.parent_comment_id === null) {
        rootComments.push(comment);
      } else {
        const parent = commentsMap.get(comment.parent_comment_id);
        if (parent) {
          parent.replies.push(comment);
        } else {
          rootComments.push(comment);
        }
      }
    });

    res.json({
      post,
      comments: rootComments
    });
  } catch (error) {
    console.error('Get forum post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/posts/{id}/comments:
 *   post:
 *     summary: Add a comment to a forum post
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.post('/posts/:id/comments', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parent_comment_id } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'El contenido del comentario es requerido' });
    }

    // Verificar que el post existe
    const [postRows] = await pool.execute(
      'SELECT author_id FROM forum_posts WHERE id = ?',
      [id]
    );

    if (postRows.length === 0) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    // Verificar permisos para estudiantes
    if (req.user.role === 'estudiante') {
      const [accessRows] = await pool.execute(
        `SELECT 1 FROM formador_courses fc
         JOIN course_assignments ca ON fc.course_id = ca.course_id
         WHERE fc.formador_id = ? AND ca.student_id = ?`,
        [postRows[0].author_id, req.user.id]
      );

      if (accessRows.length === 0) {
        return res.status(403).json({ message: 'No tienes permiso para comentar en este post' });
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO forum_comments (post_id, parent_comment_id, content, author_id) VALUES (?, ?, ?, ?)',
      [id, parent_comment_id || null, content, req.user.id]
    );

    // Crear notificaciones
    if (parent_comment_id) {
      // Es una respuesta a un comentario
      const [parentComment] = await pool.execute(
        'SELECT author_id FROM forum_comments WHERE id = ?',
        [parent_comment_id]
      );
      
      if (parentComment.length > 0 && parentComment[0].author_id !== req.user.id) {
        await pool.execute(
          'INSERT INTO forum_notifications (user_id, type, related_post_id, related_comment_id, message) VALUES (?, ?, ?, ?, ?)',
          [parentComment[0].author_id, 'comment_reply', id, result.insertId, `${req.user.name} respondió a tu comentario`]
        );

        // Send real-time notification
        if (global.io) {
          global.io.to(`user-${parentComment[0].author_id}`).emit('new-notification', {
            type: 'comment_reply',
            message: `${req.user.name} respondió a tu comentario`,
            post_id: id,
            comment_id: result.insertId
          });
        }
      }
    } else {
      // Es un comentario nuevo en el post
      const [postAuthor] = await pool.execute(
        'SELECT author_id FROM forum_posts WHERE id = ?',
        [id]
      );
      
      if (postAuthor.length > 0 && postAuthor[0].author_id !== req.user.id) {
        await pool.execute(
          'INSERT INTO forum_notifications (user_id, type, related_post_id, related_comment_id, message) VALUES (?, ?, ?, ?, ?)',
          [postAuthor[0].author_id, 'new_comment', id, result.insertId, `${req.user.name} comentó en tu publicación`]
        );

        // Send real-time notification
        if (global.io) {
          global.io.to(`user-${postAuthor[0].author_id}`).emit('new-notification', {
            type: 'new_comment',
            message: `${req.user.name} comentó en tu publicación`,
            post_id: id,
            comment_id: result.insertId
          });
        }
      }
    }

    res.status(201).json({
      message: 'Comentario agregado exitosamente',
      commentId: result.insertId
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/posts/{id}:
 *   delete:
 *     summary: Delete a forum post (author or admin only)
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/posts/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el post existe y obtener el autor
    const [postRows] = await pool.execute(
      'SELECT author_id FROM forum_posts WHERE id = ?',
      [id]
    );

    if (postRows.length === 0) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    // Solo el autor o admin pueden eliminar
    if (req.user.role !== 'admin' && req.user.id !== postRows[0].author_id) {
      return res.status(403).json({ message: 'No tienes permiso para eliminar este post' });
    }

    // Eliminar comentarios primero
    await pool.execute('DELETE FROM forum_comments WHERE post_id = ?', [id]);
    
    // Eliminar el post
    await pool.execute('DELETE FROM forum_posts WHERE id = ?', [id]);

    res.json({ message: 'Post eliminado exitosamente' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/notifications:
 *   get:
 *     summary: Get user's forum notifications
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.get('/notifications', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT fn.*, fp.title as post_title
       FROM forum_notifications fn
       LEFT JOIN forum_posts fp ON fn.related_post_id = fp.id
       WHERE fn.user_id = ?
       ORDER BY fn.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({ notifications: rows });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/notifications/unread-count:
 *   get:
 *     summary: Get count of unread notifications
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.get('/notifications/unread-count', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM forum_notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    res.json({ count: rows[0].count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/notifications/{id}/mark-read:
 *   put:
 *     summary: Mark notification as read
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.put('/notifications/:id/mark-read', auth, async (req, res) => {
  try {
    const { id } = req.params;

    await pool.execute(
      'UPDATE forum_notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    res.json({ message: 'Notificación marcada como leída' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/forum/notifications/mark-all-read:
 *   put:
 *     summary: Mark all notifications as read
 *     tags: [Forum]
 *     security:
 *       - bearerAuth: []
 */
router.put('/notifications/mark-all-read', auth, async (req, res) => {
  try {
    await pool.execute(
      'UPDATE forum_notifications SET is_read = TRUE WHERE user_id = ?',
      [req.user.id]
    );

    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;