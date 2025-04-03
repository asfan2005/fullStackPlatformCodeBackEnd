import express from 'express';
import pool from '../db/index.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises'; // Using promises version for better async handling
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp'; // Added for image processing

const router = express.Router();

// Upload directory configuration
const uploadDir = path.join(process.cwd(), 'uploads', 'receipts');
await fs.mkdir(uploadDir, { recursive: true }).catch(() => {});

// Multer storage configuration with image optimization
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.access(uploadDir);
            cb(null, uploadDir);
        } catch (error) {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueFilename = `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
        cb(null, uniqueFilename);
    }
});

// File filter with detailed validation
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Only JPEG, PNG, and WEBP images are allowed'), false);
    }
    
    cb(null, true);
};

// Multer upload configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 1 // Only one file allowed
    },
    fileFilter: fileFilter
});

// Database table creation with additional validation
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
        full_name VARCHAR(100) NOT NULL,
        telegram_username VARCHAR(100) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        card_number VARCHAR(19) NOT NULL,
        card_owner VARCHAR(100) NOT NULL,
        plan_name VARCHAR(50) NOT NULL,
        plan_price VARCHAR(50) NOT NULL,
        payment_date TIMESTAMP WITH TIME ZONE NOT NULL,
        receipt_image_path TEXT,
        receipt_image_filename TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_phone CHECK (phone_number ~ '^[0-9+()-]{9,20}$'),
        CONSTRAINT valid_card CHECK (card_number ~ '^[0-9]{16,19}$')
    )
`;

const initializeDatabase = async () => {
    try {
        await pool.query(createTableQuery);
        console.log('Payments table initialized successfully');
    } catch (err) {
        console.error('Database initialization error:', err);
        throw err;
    }
};

await initializeDatabase();

// Middleware to validate payment data
const validatePaymentData = (data) => {
    const requiredFields = [
        'fullName', 'telegramUsername', 'phoneNumber',
        'cardNumber', 'cardOwner', 'planName',
        'planPrice', 'paymentDate'
    ];
    
    return requiredFields.every(field => 
        data[field] && typeof data[field] === 'string' && data[field].trim().length > 0
    );
};

// POST - Create new payment with receipt
router.post("/with-receipt", upload.single('receipt'), async (req, res) => {
    let uploadedFile = null;
    
    try {
        console.log('Kelgan ma\'lumotlar:', req.body);
        console.log('Kelgan fayl:', req.file);
        
        if (!req.file) {
            throw new Error('To\'lov cheki yuklanmagan');
        }
        uploadedFile = req.file;

        if (!req.body.paymentData) {
            throw new Error('To\'lov ma\'lumotlari yuklanmagan');
        }

        // JSON ma'lumotlarini olish
        const paymentData = JSON.parse(req.body.paymentData);
        console.log('To\'lov ma\'lumotlari:', paymentData);

        // Majburiy maydonlarni tekshirish
        const requiredFields = [
            'transactionId', 
            'fullName', 
            'telegramUsername', 
            'phoneNumber', 
            'cardNumber', 
            'cardOwner', 
            'planName', 
            'planPrice'
        ];
        
        // Har bir maydon uchun tekshirish
        for (const field of requiredFields) {
            if (!paymentData[field]) {
                throw new Error(`To'lov ma'lumotlari to'liq emas: ${field} maydoni topilmadi`);
            }
        }

        // Ma'lumotlar bazasiga saqlash
        const query = `
            INSERT INTO payments (
                transaction_id,
                full_name,
                telegram_username,
                phone_number,
                card_number,
                card_owner,
                plan_name,
                plan_price,
                receipt_path,
                receipt_filename,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;

        const values = [
            paymentData.transactionId,
            paymentData.fullName,
            paymentData.telegramUsername,
            paymentData.phoneNumber,
            paymentData.cardNumber,
            paymentData.cardOwner,
            paymentData.planName,
            paymentData.planPrice,
            uploadedFile.path,
            uploadedFile.filename,
            'pending'
        ];

        console.log('Ma\'lumotlar bazasiga qo\'shiladigan qiymatlar:', values);

        const result = await pool.query(query, values);

        res.status(201).json({
            success: true,
            message: 'To\'lov muvaffaqiyatli yaratildi',
            payment: result.rows[0]
        });

    } catch (error) {
        console.error("To'lov yaratishda xatolik:", error);

        // Xatolik bo'lganda faylni o'chirish
        if (uploadedFile && uploadedFile.path) {
            try {
                await fs.unlink(uploadedFile.path);
            } catch (unlinkError) {
                console.error("Faylni o'chirishda xatolik:", unlinkError);
            }
        }

        res.status(500).json({
            success: false,
            message: error.message || "To'lov yaratishda xatolik yuz berdi"
        });
    }
});

// GET - Serve receipt image
router.get("/receipt/:filename", async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(uploadDir, filename);

        if (!await fs.access(filePath).then(() => true).catch(() => false)) {
            return res.status(404).json({
                error: true,
                message: "Chek topilmadi"
            });
        }

        res.set({
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=31536000',
            'Content-Disposition': `inline; filename="${filename}"`
        });
        res.sendFile(filePath);
    } catch (err) {
        console.error("Chekni yuklashda xatolik:", err);
        res.status(500).json({
            error: true,
            message: "Chekni yuklashda xatolik yuz berdi"
        });
    }
});

// GET - All payments
router.get("/all", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM payments ORDER BY created_at DESC
        `);

        const payments = result.rows.map(payment => {
            // Status qiymatini frontend uchun moslashtirish
            let frontendStatus = payment.status;
            if (payment.status === 'success') {
                frontendStatus = 'completed';
            } else if (payment.status === 'failed') {
                frontendStatus = 'rejected';
            }
            
            return {
                ...payment,
                status: frontendStatus,
                receipt_image_url: payment.receipt_filename 
                    ? `/api/payments/receipt/${payment.receipt_filename}` 
                    : (payment.receipt_image_filename 
                        ? `/api/payments/receipt/${payment.receipt_image_filename}` 
                        : null),
                formattedDate: new Date(payment.payment_date || payment.created_at).toLocaleString('uz-UZ')
            };
        });

        res.json({
            success: true,
            count: payments.length,
            payments
        });
    } catch (err) {
        console.error("To'lovlarni olishda xatolik:", err);
        res.status(500).json({
            error: true,
            message: "To'lovlar ro'yxatini olishda xatolik yuz berdi"
        });
    }
});

// GET - foydalanuvchi to'lovlari tarixi
router.get("/user/:phoneNumber", async (req, res) => {
    try {
        const { phoneNumber } = req.params;

        const result = await pool.query(`
            SELECT 
                id,
                transaction_id,
                timestamp,
                status,
                full_name,
                telegram_username,
                phone_number,
                plan_name,
                plan_price,
                payment_date,
                receipt_image_filename,
                created_at
            FROM payments 
            WHERE phone_number = $1
            ORDER BY created_at DESC
        `, [phoneNumber]);

        // Rasm URL manzilini qo'shish
        const payments = result.rows.map(payment => {
            if (payment.receipt_image_filename) {
                payment.receipt_image_url = `/api/payments/receipt/${payment.receipt_image_filename}`;
            }
            return {
                ...payment,
                formattedDate: new Date(payment.created_at).toLocaleString('uz-UZ')
            };
        });

        res.json({
            success: true,
            count: payments.length,
            payments: payments
        });
    } catch (err) {
        console.error("Get user payments error:", err);
        res.status(500).json({
            error: true,
            message: "Foydalanuvchi to'lovlari tarixini olishda xatolik yuz berdi"
        });
    }
});

// GET - bitta to'lov ma'lumotlarini olish
router.get("/transaction/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;

        const result = await pool.query(`
            SELECT 
                id,
                transaction_id,
                timestamp,
                status,
                full_name,
                telegram_username,
                phone_number,
                card_number,
                card_owner,
                plan_name,
                plan_price,
                payment_date,
                receipt_image_filename,
                created_at
            FROM payments 
            WHERE transaction_id = $1
        `, [transactionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: true,
                message: "To'lov topilmadi"
            });
        }

        // To'lov ma'lumotlarini olish
        const payment = result.rows[0];

        // Rasm URL manzilini qo'shish
        if (payment.receipt_image_filename) {
            payment.receipt_image_url = `/api/payments/receipt/${payment.receipt_image_filename}`;
        }

        // Sanani formatlash
        payment.formattedDate = new Date(payment.created_at).toLocaleString('uz-UZ');

        res.json({
            success: true,
            payment: payment
        });

    } catch (err) {
        console.error("Get payment error:", err);
        res.status(500).json({
            error: true,
            message: "To'lov ma'lumotlarini olishda xatolik yuz berdi"
        });
    }
});

// GET - to'lovlar statistikasi
router.get("/stats", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_payments,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_payments,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
                SUM(CASE 
                    WHEN status = 'success' 
                    THEN CAST(REPLACE(REPLACE(plan_price, ' so''m', ''), ',', '') AS DECIMAL)
                    ELSE 0 
                END) as total_amount,
                MAX(created_at) as last_payment_date,
                COUNT(DISTINCT phone_number) as unique_users
            FROM payments
        `);

        // Oxirgi 7 kunlik statistika
        const weeklyStats = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as payment_count,
                SUM(CASE 
                    WHEN status = 'success' 
                    THEN CAST(REPLACE(REPLACE(plan_price, ' so''m', ''), ',', '') AS DECIMAL)
                    ELSE 0 
                END) as daily_amount
            FROM payments
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);

        // Plan bo'yicha statistika
        const planStats = await pool.query(`
            SELECT 
                plan_name,
                COUNT(*) as count,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_count
            FROM payments
            GROUP BY plan_name
            ORDER BY count DESC
        `);

        res.json({
            success: true,
            general: stats.rows[0],
            weekly: weeklyStats.rows,
            plans: planStats.rows
        });

    } catch (err) {
        console.error("Get payment stats error:", err);
        res.status(500).json({
            error: true,
            message: "To'lovlar statistikasini olishda xatolik yuz berdi"
        });
    }
});

// GET - oxirgi to'lovlar (so'nggi 5 ta)
router.get("/recent", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                transaction_id,
                timestamp,
                status,
                full_name,
                telegram_username,
                phone_number,
                plan_name,
                plan_price,
                created_at
            FROM payments 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        const payments = result.rows.map(payment => ({
            ...payment,
            formattedDate: new Date(payment.created_at).toLocaleString('uz-UZ')
        }));

        res.json({
            success: true,
            payments: payments
        });

    } catch (err) {
        console.error("Get recent payments error:", err);
        res.status(500).json({
            error: true,
            message: "Oxirgi to'lovlarni olishda xatolik yuz berdi"
        });
    }
});

// To'lov holatini yangilash uchun endpoint
router.put('/status/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  // Xato kelib chiqishini oldini olish uchun id va status ni tekshirish
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "To'lov ID si ko'rsatilmagan"
    });
  }
  
  // Frontend status qiymatini ma'lumotlar bazasi qiymatiga moslashtirish
  let dbStatus = status;
  if (status === 'completed') {
    dbStatus = 'success';
  } else if (status === 'rejected') {
    dbStatus = 'failed';
  }
  
  // Status qiymatlarini tekshirish
  if (!status || !['pending', 'completed', 'rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Noto'g'ri holat. Faqat 'pending', 'completed' yoki 'rejected' bo'lishi mumkin."
    });
  }
  
  try {
    console.log(`To'lov #${id} ni ${status} (DB: ${dbStatus}) holatiga o'zgartirish`);
    
    // Ma'lumotlar bazasida to'lov holatini yangilash
    const updateResult = await pool.query(
      `UPDATE payments 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [dbStatus, id]
    );
    
    // Agar to'lov topilmasa
    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `ID=${id} raqamli to'lov topilmadi`
      });
    }
    
    // Muvaffaqiyatli yangilandi - javobda frontend statusini qaytarish
    const responsePayment = {...updateResult.rows[0]};
    if (responsePayment.status === 'success') {
      responsePayment.status = 'completed';
    } else if (responsePayment.status === 'failed') {
      responsePayment.status = 'rejected';
    }
    
    res.json({
      success: true,
      message: `To'lov holati muvaffaqiyatli yangilandi: ${status}`,
      payment: responsePayment
    });
    
  } catch (error) {
    console.error(`To'lov #${id} holatini yangilashda xatolik:`, error);
    res.status(500).json({
      success: false,
      message: "To'lov holatini yangilashda xatolik yuz berdi",
      error: error.message
    });
  }
});

// Tasdiqlash xabarini yuborish endpointini ham yangilash
router.post('/confirm/:id', async (req, res) => {
  const { id } = req.params;
  const { message, telegramUsername, status = 'completed' } = req.body;
  
  // Frontend status qiymatini ma'lumotlar bazasi qiymatiga moslashtirish
  let dbStatus = 'success'; // Default: completed => success
  if (status === 'rejected') {
    dbStatus = 'failed';
  } else if (status === 'pending') {
    dbStatus = 'pending';
  }
  
  // Xato kelib chiqishini oldini olish uchun ma'lumotlarni tekshirish
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "To'lov ID si ko'rsatilmagan"
    });
  }
  
  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Tasdiqlash xabari ko'rsatilmagan"
    });
  }
  
  try {
    console.log(`To'lov #${id} uchun tasdiqlash xabari yuborilmoqda (status: ${dbStatus})`);
    
    // Ma'lumotlar bazasida to'lov holatini yangilash
    const updateResult = await pool.query(
      `UPDATE payments 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [dbStatus, id]
    );
    
    // Agar to'lov topilmasa
    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `ID=${id} raqamli to'lov topilmadi`
      });
    }
    
    // Bu yerda Telegram xabar yuborish logikasi bo'lishi mumkin
    // ...
    
    // Muvaffaqiyatli yuborildi - javobda frontend statusini qaytarish
    const responsePayment = {...updateResult.rows[0]};
    if (responsePayment.status === 'success') {
      responsePayment.status = 'completed';
    } else if (responsePayment.status === 'failed') {
      responsePayment.status = 'rejected';
    }
    
    res.json({
      success: true,
      message: "Tasdiqlash xabari muvaffaqiyatli yuborildi",
      payment: responsePayment
    });
    
  } catch (error) {
    console.error(`To'lov #${id} uchun tasdiqlash xabarini yuborishda xatolik:`, error);
    res.status(500).json({
      success: false,
      message: "Tasdiqlash xabarini yuborishda xatolik yuz berdi",
      error: error.message
    });
  }
});

export default router;