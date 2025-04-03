import express from 'express';
import pool from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Obuna holatini olish
router.get("/status", async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT 
        s.*,
        p.transaction_id,
        p.full_name,
        p.phone_number
      FROM subscriptions s
      JOIN payments p ON s.payment_id = p.id
      WHERE s.user_id = $1 AND s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        subscription: null
      });
    }

    const subscription = result.rows[0];
    const now = new Date();
    const endDate = new Date(subscription.end_date);

    subscription.isActive = now < endDate;

    if (!subscription.isActive) {
      await pool.query(
        `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
        [subscription.id]
      );
    }

    res.json({
      success: true,
      subscription: {
        ...subscription,
        startDate: subscription.start_date,
        endDate: subscription.end_date,
      }
    });

  } catch (err) {
    console.error("Obuna holatini olishda xatolik:", err);
    res.status(500).json({
      error: true,
      message: "Obuna holatini olishda xatolik yuz berdi"
    });
  }
});

// Yangi obuna yaratish
router.post("/create", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { userId, paymentId, planName, planPrice } = req.body;

    const currentSub = await client.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND status = 'active'
       ORDER BY end_date DESC LIMIT 1`,
      [userId]
    );

    let startDate;
    if (currentSub.rows.length > 0 && new Date(currentSub.rows[0].end_date) > new Date()) {
      startDate = new Date(currentSub.rows[0].end_date);
      
      await client.query(
        `UPDATE subscriptions SET status = 'inactive' WHERE id = $1`,
        [currentSub.rows[0].id]
      );
    } else {
      startDate = new Date();
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    const result = await client.query(
      `INSERT INTO subscriptions (
        user_id, payment_id, start_date, end_date, 
        status, plan_name, plan_price
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [userId, paymentId, startDate, endDate, 'active', planName, planPrice]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: "Obuna muvaffaqiyatli yaratildi",
      subscription: result.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Obuna yaratishda xatolik:", err);
    res.status(500).json({
      error: true,
      message: "Obuna yaratishda xatolik yuz berdi"
    });
  } finally {
    client.release();
  }
});

export default router;