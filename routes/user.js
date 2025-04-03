import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

// POST endpoint - yangi foydalanuvchi qo'shish
router.post("/", async (req, res) => {
    try {
        const { firstname, lastname } = req.body;
        
        // Ma'lumotlarni tekshirish
        if (!firstname || !lastname) {
            return res.status(400).send("Ism va familiya kiritilishi shart");
        }

        const result = await pool.query(
            "INSERT INTO users (firstname, lastname) VALUES ($1, $2) RETURNING *",
            [firstname, lastname]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server xatosi");
    }
});

// GET endpoint - barcha foydalanuvchilarni olish
router.get("/", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM users");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server xatosi");
    }
});

export default router;