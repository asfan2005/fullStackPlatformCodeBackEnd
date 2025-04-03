import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db/index.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Ro'yxatdan o'tish
router.post('/register', async (req, res) => {
    try {
        const {
            fullName,
            phoneNumber,
            telegramUsername,
            password
        } = req.body;

        // Telefon raqami mavjudligini tekshirish
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE phone_number = $1',
            [phoneNumber]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                error: true,
                message: "Bu telefon raqami allaqachon ro'yxatdan o'tgan"
            });
        }

        // Parolni hashlash
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Foydalanuvchini saqlash
        const result = await pool.query(
            `INSERT INTO users (
                full_name, phone_number, telegram_username, password_hash
            ) VALUES ($1, $2, $3, $4) RETURNING id, full_name, phone_number, role`,
            [fullName, phoneNumber, telegramUsername, passwordHash]
        );

        // Token yaratish
        const token = jwt.sign(
            { userId: result.rows[0].id },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            success: true,
            message: "Ro'yxatdan o'tish muvaffaqiyatli yakunlandi",
            user: result.rows[0],
            token
        });

    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({
            error: true,
            message: "Ro'yxatdan o'tishda xatolik yuz berdi"
        });
    }
});

// Tizimga kirish
router.post('/login', async (req, res) => {
    try {
        const { phoneNumber, password } = req.body;

        // Foydalanuvchini topish
        const result = await pool.query(
            'SELECT id, full_name, phone_number, password_hash, role FROM users WHERE phone_number = $1',
            [phoneNumber]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: true,
                message: "Telefon raqami yoki parol noto'g'ri"
            });
        }

        const user = result.rows[0];

        // Parolni tekshirish
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({
                error: true,
                message: "Telefon raqami yoki parol noto'g'ri"
            });
        }

        // Token yaratish
        const token = jwt.sign(
            { userId: user.id },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Password hash ni olib tashlash
        delete user.password_hash;

        res.json({
            success: true,
            message: "Tizimga muvaffaqiyatli kirdingiz",
            user,
            token
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({
            error: true,
            message: "Tizimga kirishda xatolik yuz berdi"
        });
    }
});

export default router; 