import express from 'express';
import pool from '../db/index.js';
import axios from 'axios';
import querystring from 'querystring';

const router = express.Router();

// Users jadvalini yaratish uchun SQL - faqat mavjud bo'lmasa yaratadi
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        fullName VARCHAR(100) NOT NULL,
        codeName VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(20) UNIQUE,
        password VARCHAR(255),
        confirmPassword VARCHAR(255),
        telegram_username VARCHAR(100),
        role VARCHAR(20) DEFAULT 'user',
        status VARCHAR(20) DEFAULT 'active',
        provider VARCHAR(50),
        providerId VARCHAR(100),
        avatar TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
`;

// Jadval yaratish - faqat mavjud bo'lmasa
const initializeDatabase = async () => {
    try {
        // Jadval yaratish (mavjud bo'lmasa)
        await pool.query(createTableQuery);
        console.log('Users table checked/created successfully');
    } catch (err) {
        console.error("Database initialization error:", err);
    }
};

// Database initialization
await initializeDatabase();

// Google OAuth konfiguratsiyasi
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// GitHub OAuth konfiguratsiyasi
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = 'http://localhost:3000/api/users/auth/github/callback';

// Google OAuth endpoint
router.get('/auth/google', (req, res) => {
  const googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    client_id: process.env.GOOGLE_CLIENT_ID,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  res.redirect(`${googleAuthUrl}?${querystring.stringify(options)}`);
});

// Google OAuth callback
router.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    // Token olish
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token } = tokenResponse.data;

    // Foydalanuvchi ma'lumotlarini olish
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const userData = userInfoResponse.data;

    // Foydalanuvchini bazada tekshirish yoki yaratish
    const user = await findOrCreateUser({
      email: userData.email,
      fullName: userData.name || 'Google User',
      codeName: userData.given_name || userData.email.split('@')[0],
      provider: 'google',
      providerId: userData.id,
      avatar: userData.picture
    });

    // Token yaratish
    const token = "google-token-" + Date.now();

    // Frontend ga qaytarish uchun URL
    const redirectUrl = `http://localhost:5173/?token=${token}&userId=${user.id}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect('http://localhost:5173/auth-error');
  }
});

// GitHub OAuth endpoint
router.get('/auth/github', (req, res) => {
  const githubAuthUrl = 'https://github.com/login/oauth/authorize';
  const options = {
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: 'user:email',
  };

  res.redirect(`${githubAuthUrl}?${querystring.stringify(options)}`);
});

// GitHub OAuth callback
router.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    // Token olish
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      },
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    const { access_token } = tokenResponse.data;

    // Foydalanuvchi ma'lumotlarini olish
    const userInfoResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${access_token}`,
      },
    });

    const userData = userInfoResponse.data;
    console.log('GitHub user data:', userData);

    // Email olish (GitHub ba'zan emailni bermasligi mumkin)
    let email = userData.email;
    if (!email) {
      try {
        const emailsResponse = await axios.get('https://api.github.com/user/emails', {
          headers: {
            Authorization: `token ${access_token}`,
          },
        });
        
        const primaryEmail = emailsResponse.data.find(email => email.primary);
        email = primaryEmail ? primaryEmail.email : `${userData.login}@github.com`;
      } catch (err) {
        console.error('Error fetching GitHub emails:', err);
        email = `${userData.login}@github.com`;
      }
    }

    // Foydalanuvchini bazada tekshirish yoki yaratish
    let user = await findOrCreateUser({
      email: email,
      fullName: userData.name || userData.login,
      codeName: userData.login,
      provider: 'github',
      providerId: userData.id.toString(),
      avatar: userData.avatar_url
    });

    // Token yaratish
    const token = "github-token-" + Date.now();

    // Frontend ga qaytarish uchun URL
    const redirectUrl = `http://localhost:5173?token=${token}&userId=${user.id}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect('http://localhost:5173');
  }
});

// Foydalanuvchini topish yoki yaratish
async function findOrCreateUser(userData) {
  try {
    // Avval foydalanuvchini email orqali tekshirish
    const existingUserQuery = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [userData.email]
    );

    if (existingUserQuery.rows.length > 0) {
      // Foydalanuvchi mavjud, ma'lumotlarini yangilash
      const user = existingUserQuery.rows[0];
      
      // Provider ma'lumotlarini yangilash
      await pool.query(
        "UPDATE users SET provider = $1, providerId = $2, avatar = $3, fullName = $4, codeName = $5 WHERE id = $6",
        [userData.provider, userData.providerId, userData.avatar, userData.fullName, userData.codeName, user.id]
      );
      
      return user;
    } else {
      // Yangi foydalanuvchi yaratish
      const result = await pool.query(
        "INSERT INTO users (fullName, codeName, email, provider, providerId, avatar) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [userData.fullName, userData.codeName, userData.email, userData.provider, userData.providerId, userData.avatar]
      );
      
      return result.rows[0];
    }
  } catch (error) {
    console.error('Error finding or creating user:', error);
    throw error;
  }
}

// POST endpoint - yangi foydalanuvchi qo'shish
router.post("/", async (req, res, next) => {
    try {
        const { fullName, codeName, email, phone, password, confirmPassword } = req.body;
        
        // Ma'lumotlarni tekshirish
        if (!fullName || !codeName || !email || !phone || !password || !confirmPassword) {
            return res.status(400).json({
                error: true,
                message: "Barcha maydonlar to'ldirilishi shart"
            });
        }
        
        // Email formatini tekshirish
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: true,
                message: "Noto'g'ri email format"
            });
        }

        // Telefon raqami formatini tekshirish
        const phoneRegex = /^\+998[0-9]{9}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                error: true,
                message: "Telefon raqami +998 bilan boshlanishi va 12 raqamdan iborat bo'lishi kerak"
            });
        }
        
        // Parol uzunligini tekshirish
        if (password.length < 6) {
            return res.status(400).json({
                error: true,
                message: "Parol kamida 6 ta belgidan iborat bo'lishi kerak"
            });
        }
        
        // Parollar bir xil ekanligini tekshirish
        if (password !== confirmPassword) {
            return res.status(400).json({
                error: true,
                message: "Parollar mos kelmadi"
            });
        }
        
        // Email va telefon mavjudligini tekshirish
        const existingUser = await pool.query(
            "SELECT * FROM users WHERE email = $1 OR phone = $2",
            [email, phone]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                error: true,
                message: "Bu email yoki telefon raqami allaqachon ro'yxatdan o'tgan"
            });
        }

        // Yangi foydalanuvchi qo'shish
        const result = await pool.query(
            `INSERT INTO users (
                fullName, 
                codeName, 
                email, 
                phone, 
                password, 
                confirmPassword
            ) VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id, fullName, codeName, email, phone`,
            [fullName, codeName, email, phone, password, confirmPassword]
        );
        
        const newUser = result.rows[0];
        
        res.status(201).json({
            success: true,
            message: "Ro'yxatdan muvaffaqiyatli o'tildi",
            user: newUser
        });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({
            error: true,
            message: "Serverda xatolik yuz berdi"
        });
    }
});

// Login endpoint
router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                error: true,
                message: "Email va parol kiritilishi shart"
            });
        }

        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: true,
                message: "Email yoki parol noto'g'ri"
            });
        }

        const user = result.rows[0];

        if (user.password !== password) {
            return res.status(401).json({
                error: true,
                message: "Email yoki parol noto'g'ri"
            });
        }

        // Xavfsizlik uchun parollarni olib tashlash
        delete user.password;
        delete user.confirmPassword;

        const token = "token-" + Date.now();

        res.status(200).json({
            success: true,
            message: "Muvaffaqiyatli kirildi",
            user: {
                id: user.id,
                fullName: user.fullName,
                codeName: user.codeName,
                email: user.email,
                phone: user.phone
            },
            token
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({
            error: true,
            message: "Serverda xatolik yuz berdi"
        });
    }
});

// GET endpoint - barcha foydalanuvchilarni olish
router.get("/", async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT 
                id,
                fullName,
                codeName,
                email,
                phone,
                password,
                confirmPassword,
                created_at,
                updated_at
            FROM users
            ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Get users error:", err);
        res.status(500).json({
            error: true,
            message: "Foydalanuvchilar ma'lumotlarini olishda xatolik yuz berdi"
        });
    }
});

// GET endpoint - bitta foydalanuvchi ma'lumotlarini olish
router.get("/:id", async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `SELECT 
                id,
                fullName,
                codeName,
                email,
                phone,
                password,
                confirmPassword,
                created_at,
                updated_at
            FROM users 
            WHERE id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: true,
                message: "Foydalanuvchi topilmadi"
            });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Get user error:", err);
        res.status(500).json({
            error: true,
            message: "Foydalanuvchi ma'lumotlarini olishda xatolik yuz berdi"
        });
    }
});

// GET endpoint - email bo'yicha foydalanuvchi ma'lumotlarini olish
router.get("/email/:email", async (req, res, next) => {
    try {
        const { email } = req.params;
        
        const result = await pool.query(
            `SELECT 
                id,
                fullName,
                codeName,
                email,
                phone,
                password,
                confirmPassword,
                created_at,
                updated_at
            FROM users 
            WHERE email = $1`,
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: true,
                message: "Foydalanuvchi topilmadi"
            });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Get user by email error:", err);
        res.status(500).json({
            error: true,
            message: "Foydalanuvchi ma'lumotlarini olishda xatolik yuz berdi"
        });
    }
});

// DELETE endpoint - foydalanuvchini ID bo'yicha o'chirish
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Avval foydalanuvchi mavjudligini tekshirish
        const checkUser = await pool.query(
            "SELECT * FROM users WHERE id = $1",
            [id]
        );

        if (checkUser.rows.length === 0) {
            return res.status(404).json({
                error: true,
                message: "Foydalanuvchi topilmadi"
            });
        }

        // Foydalanuvchini o'chirish
        await pool.query(
            "DELETE FROM users WHERE id = $1",
            [id]
        );

        res.status(200).json({
            success: true,
            message: "Foydalanuvchi muvaffaqiyatli o'chirildi"
        });

    } catch (err) {
        console.error("Delete user error:", err);
        res.status(500).json({
            error: true,
            message: "Foydalanuvchini o'chirishda xatolik yuz berdi"
        });
    }
});

// PUT endpoint - foydalanuvchi ma'lumotlarini yangilash
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, codeName, email, phone } = req.body;

        // Ma'lumotlarni tekshirish
        if (!fullName || !codeName || !email || !phone) {
            return res.status(400).json({
                error: true,
                message: "Barcha maydonlar to'ldirilishi shart"
            });
        }

        // Email formatini tekshirish
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: true,
                message: "Noto'g'ri email format"
            });
        }

        // Telefon raqami formatini tekshirish
        const phoneRegex = /^\+998[0-9]{9}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                error: true,
                message: "Telefon raqami +998 bilan boshlanishi va 12 raqamdan iborat bo'lishi kerak"
            });
        }

        // Email va telefon mavjudligini tekshirish (o'ziga xos)
        const existingUser = await pool.query(
            "SELECT * FROM users WHERE (email = $1 OR phone = $2) AND id != $3",
            [email, phone, id]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                error: true,
                message: "Bu email yoki telefon raqami allaqachon ro'yxatdan o'tgan"
            });
        }

        // Foydalanuvchi ma'lumotlarini yangilash
        const result = await pool.query(
            `UPDATE users 
             SET fullName = $1, 
                 codeName = $2, 
                 email = $3, 
                 phone = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5 
             RETURNING id, fullName, codeName, email, phone, created_at, updated_at`,
            [fullName, codeName, email, phone, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: true,
                message: "Foydalanuvchi topilmadi"
            });
        }

        res.status(200).json({
            success: true,
            message: "Foydalanuvchi ma'lumotlari muvaffaqiyatli yangilandi",
            user: result.rows[0]
        });

    } catch (err) {
        console.error("Update user error:", err);
        res.status(500).json({
            error: true,
            message: "Serverda xatolik yuz berdi"
        });
    }
});

export default router; 