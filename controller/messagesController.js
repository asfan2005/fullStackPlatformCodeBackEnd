import pool from '../db/index.js';

// Barcha xabarlarni olish
export const getAllMessages = async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Userlar bo'yicha guruhlash uchun isAdmin=false bo'lgan xabarlarni olish
    const query = `
      SELECT 
        m.id,
        m.text,
        m.user_id as "userId",
        m.is_admin as "isAdmin",
        m.time,
        m.created_at as "createdAt",
        m.has_reply as "hasReply",
        (
          SELECT row_to_json(reply)
          FROM (
            SELECT 
              r.id,
              r.text,
              r.time,
              r.created_at as "createdAt"
            FROM messages r
            WHERE r.reply_to_message_id = m.id
            AND r.is_admin = true
            ORDER BY r.created_at DESC
            LIMIT 1
          ) reply
        ) as reply
      FROM messages m
      ORDER BY m.created_at DESC
    `;
    
    const result = await client.query(query);
    
    // Xabarlarni formatlash
    const messages = result.rows.map(message => ({
      ...message,
      hasReply: Boolean(message.hasReply)
    }));

    res.status(200).json({
      success: true,
      messages: messages
    });
  } catch (error) {
    console.error('Xabarlarni olishda xatolik:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Xabarlarni olishda xatolik yuz berdi',
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Foydalanuvchi xabarlarini olish
export const getUserMessages = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.query.userId || req.params.userId;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: "Foydalanuvchi ID si ko'rsatilmagan" 
      });
    }

    // Foydalanuvchining xabarlarini olish
    const query = `
      SELECT 
        m.id,
        m.text,
        m.user_id as "userId",
        m.is_admin as "isAdmin",
        m.time,
        m.created_at as "createdAt",
        m.has_reply as "hasReply",
        (
          SELECT row_to_json(reply)
          FROM (
            SELECT 
              r.id,
              r.text,
              r.time,
              r.created_at as "createdAt"
            FROM messages r
            WHERE r.reply_to_message_id = m.id
            AND r.is_admin = true
            ORDER BY r.created_at DESC
            LIMIT 1
          ) reply
        ) as reply
      FROM messages m
      WHERE m.user_id = $1 OR 
            (m.is_admin = true AND m.reply_to_message_id IN (
                SELECT id FROM messages WHERE user_id = $1
            ))
      ORDER BY m.created_at ASC
    `;
    
    const result = await client.query(query, [userId]);
    
    let messages = result.rows.map(message => ({
      ...message,
      hasReply: Boolean(message.hasReply)
    }));

    // Agar xabarlar bo'sh bo'lsa, dastlabki xabarni ko'rsatish
    if (messages.length === 0) {
      messages = [{
        id: 0,
        text: "Assalomu alaykum! Infinity-School web sitega xush kelibsiz! Sizga qanday yordam bera olaman?",
        userId: userId,
        isAdmin: true,
        time: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        hasReply: false,
        reply: null
      }];
    }

    res.status(200).json({
      success: true,
      messages: messages
    });
  } catch (error) {
    console.error('Xabarlarni olishda xatolik:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Xabarlarni olishda xatolik yuz berdi',
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Xabar yaratish
export const createMessage = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { text, userId, isAdmin } = req.body;
    
    if (!text || !userId) {
      return res.status(400).json({ 
        success: false, 
        message: "Barcha ma'lumotlar to'ldirilishi shart" 
      });
    }
    
    const query = `
      INSERT INTO messages (
        text, 
        user_id, 
        is_admin,
        has_reply
      )
      VALUES ($1, $2, $3, false)
      RETURNING 
        id,
        text,
        user_id as "userId",
        is_admin as "isAdmin",
        time,
        created_at as "createdAt",
        has_reply as "hasReply"
    `;
    
    const result = await client.query(query, [text, userId, isAdmin || false]);
    
    res.status(201).json({
      success: true,
      message: 'Xabar muvaffaqiyatli yuborildi',
      data: {
        ...result.rows[0],
        hasReply: false,
        reply: null
      }
    });
  } catch (error) {
    console.error('Xabar yaratishda xatolik:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Xabar saqlashda xatolik yuz berdi',
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Xabarga javob berish
export const replyToMessage = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { text, userId, messageId } = req.body;
    
    if (!text || !userId || !messageId) {
      return res.status(400).json({ 
        success: false, 
        message: "Barcha ma'lumotlar to'ldirilishi shart" 
      });
    }

    // Asl xabarni tekshirish
    const checkQuery = 'SELECT * FROM messages WHERE id = $1';
    const checkResult = await client.query(checkQuery, [messageId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Asl xabar topilmadi"
      });
    }

    // Javob xabarini saqlash
    const replyQuery = `
      INSERT INTO messages (
        text, 
        user_id, 
        is_admin, 
        reply_to_message_id,
        has_reply
      )
      VALUES ($1, $2, true, $3, false)
      RETURNING *
    `;

    const replyResult = await client.query(replyQuery, [text, userId, messageId]);

    // Asl xabarni yangilash
    const updateQuery = `
      UPDATE messages 
      SET has_reply = true 
      WHERE id = $1
      RETURNING *
    `;
    const updateResult = await client.query(updateQuery, [messageId]);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Javob muvaffaqiyatli yuborildi',
      data: {
        original: updateResult.rows[0],
        reply: replyResult.rows[0]
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Javob yuborishda xatolik:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Javob yuborishda xatolik yuz berdi',
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// Xabarni o'chirish
export const deleteMessage = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Xabarni o'chirish
    const result = await client.query(
      'DELETE FROM messages WHERE id = $1 OR reply_to_message_id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Xabar topilmadi'
      });
    }
    
    await client.query('COMMIT');
    
    res.status(200).json({
      success: true,
      message: 'Xabar muvaffaqiyatli o\'chirildi'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Xabarni o\'chirishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'Xabarni o\'chirishda xatolik yuz berdi'
    });
  } finally {
    client.release();
  }
};

// Foydalanuvchilar ro'yxatini olish (faqat xabar yuborgan foydalanuvchilar)
export const getMessageUsers = async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Xabar yuborgan barcha foydalanuvchilarni olish
    const query = `
      SELECT DISTINCT 
        user_id as "userId",
        COUNT(CASE WHEN is_admin = false THEN 1 END) as "totalMessages",
        COUNT(CASE WHEN is_admin = false AND has_reply = false THEN 1 END) as "unansweredMessages",
        MAX(created_at) as "lastMessageAt"
      FROM messages
      WHERE is_admin = false
      GROUP BY user_id
      ORDER BY "lastMessageAt" DESC
    `;
    
    const result = await client.query(query);
    
    res.status(200).json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('Foydalanuvchilarni olishda xatolik:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Foydalanuvchilarni olishda xatolik yuz berdi',
      error: error.message 
    });
  } finally {
    client.release();
  }
};

export default {
  getAllMessages,
  getUserMessages,
  createMessage,
  replyToMessage,
  deleteMessage,
  getMessageUsers
};