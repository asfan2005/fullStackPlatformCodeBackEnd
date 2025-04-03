import express from 'express';
import pool from '../db/index.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

const router = express.Router();

// Upload directory configuration
const uploadDir = path.join(process.cwd(), 'uploads', 'course_payments');

// Create upload directory if it doesn't exist
await fs.mkdir(uploadDir, { recursive: true }).catch(() => {});

// Multer storage configuration
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

// File filter for image validation
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    
    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error('Faqat JPEG, PNG, WEBP va GIF formatdagi rasmlar qabul qilinadi'), false);
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

// Valid status values
const VALID_STATUSES = ['pending', 'completed', 'success', 'rejected', 'failed'];

// Database table creation with comprehensive fields
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS course_payments (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'success', 'rejected', 'failed')),
        
        -- User Information
        full_name VARCHAR(100) NOT NULL,
        telegram_username VARCHAR(100) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        registration_date TIMESTAMP WITH TIME ZONE NOT NULL,
        
        -- Course Schedule
        course_start_date DATE NOT NULL,
        course_time_slot VARCHAR(50) NOT NULL,
        course_days VARCHAR(100) NOT NULL,
        
        -- Payment Information
        card_number VARCHAR(19) NOT NULL,
        card_owner VARCHAR(100) NOT NULL,
        plan_name VARCHAR(50) NOT NULL,
        plan_price VARCHAR(50) NOT NULL,
        payment_date TIMESTAMP WITH TIME ZONE NOT NULL,
        
        -- Receipt Information
        receipt_filename VARCHAR(255),
        receipt_filepath TEXT,
        receipt_filesize VARCHAR(50),
        receipt_filetype VARCHAR(50),
        receipt_upload_time TIMESTAMP WITH TIME ZONE,
        
        -- Metadata
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- Constraints
        CONSTRAINT valid_phone CHECK (phone_number ~ '^\\+?[0-9]{9,20}$')
    )
`;

// Fix existing table if needed
const fixTableQuery = `
    ALTER TABLE IF EXISTS course_payments 
    DROP CONSTRAINT IF EXISTS course_payments_status_check,
    ADD CONSTRAINT course_payments_status_check 
    CHECK (status IN ('pending', 'completed', 'success', 'rejected', 'failed'))
`;

// Initialize database
const initializeDatabase = async () => {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(createTableQuery);
            await client.query(fixTableQuery);
            await client.query('COMMIT');
            console.log('Course payments table initialized successfully');
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Database initialization error:', err);
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Database connection error:', err);
        throw err;
    }
};

// Initialize database on server start
await initializeDatabase();

// Helper function to validate payment data
const validatePaymentData = (data) => {
    const requiredFields = [
        'fullName', 'telegramUsername', 'phoneNumber', 'registrationDate',
        'startDate', 'timeSlot', 'courseDays',
        'cardNumber', 'cardOwner', 'planName', 'planPrice', 'paymentDate'
    ];
    
    const missingFields = requiredFields.filter(field => 
        !data[field] || typeof data[field] !== 'string' || data[field].trim().length === 0
    );
    
    if (missingFields.length > 0) {
        return {
            valid: false,
            message: `Quyidagi maydonlar to'ldirilmagan: ${missingFields.join(', ')}`
        };
    }
    
    return { valid: true };
};

// POST - Create new course payment with receipt
router.post("/create", upload.single('receipt'), async (req, res) => {
    let tempFilePath = null;
    
    try {
        // Generate transaction ID
        const transactionId = `CP-${uuidv4().substring(0, 8)}-${Date.now().toString().substring(8)}`;
        
        // Parse payment data
        let paymentData;
        try {
            paymentData = typeof req.body.paymentData === 'string' 
                ? JSON.parse(req.body.paymentData) 
                : req.body;
        } catch (error) {
            throw new Error('To\'lov ma\'lumotlarini qayta ishlashda xatolik');
        }
        
        // Validate payment data
        const validation = validatePaymentData(paymentData);
        if (!validation.valid) {
            throw new Error(validation.message);
        }
        
        // Process receipt image if uploaded
        let receiptFilename = null;
        let receiptFilepath = null;
        let receiptFilesize = null;
        let receiptFiletype = null;
        let receiptUploadTime = null;
        
        if (req.file) {
            // Optimize image
            tempFilePath = path.join(uploadDir, `${uuidv4()}-temp${path.extname(req.file.filename)}`);
            
            await sharp(req.file.path)
                .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toFile(tempFilePath);
                
            receiptFilename = paymentData.fileName || req.file.originalname;
            receiptFilepath = req.file.path;
            receiptFilesize = paymentData.fileSize || `${(req.file.size / 1024).toFixed(2)} KB`;
            receiptFiletype = paymentData.fileType || req.file.mimetype;
            receiptUploadTime = paymentData.uploadTime || new Date().toISOString();
            
            // Replace original file with optimized version
            await fs.rename(tempFilePath, req.file.path);
        }
        
        // Insert payment data into database
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await client.query(
                `INSERT INTO course_payments (
                    transaction_id, status,
                    full_name, telegram_username, phone_number, registration_date,
                    course_start_date, course_time_slot, course_days,
                    card_number, card_owner, plan_name, plan_price, payment_date,
                    receipt_filename, receipt_filepath, receipt_filesize, receipt_filetype, receipt_upload_time
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                RETURNING *`,
                [
                    transactionId,
                    'pending',
                    paymentData.fullName,
                    paymentData.telegramUsername,
                    paymentData.phoneNumber,
                    paymentData.registrationDate,
                    paymentData.startDate,
                    paymentData.timeSlot,
                    paymentData.courseDays,
                    paymentData.cardNumber,
                    paymentData.cardOwner,
                    paymentData.planName,
                    paymentData.planPrice,
                    paymentData.paymentDate,
                    receiptFilename,
                    receiptFilepath,
                    receiptFilesize,
                    receiptFiletype,
                    receiptUploadTime
                ]
            );
            
            await client.query('COMMIT');
            
            // Prepare response
            const payment = result.rows[0];
            if (payment.receipt_filename) {
                payment.receipt_url = `/api/payment-page/receipt/${payment.id}`;
            }
            
            res.status(201).json({
                success: true,
                message: "To'lov muvaffaqiyatli yaratildi",
                transactionId: payment.transaction_id,
                payment
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (err) {
        // Clean up temporary files if error occurs
        if (tempFilePath) {
            await fs.unlink(tempFilePath).catch(() => {});
        }
        if (req.file?.path) {
            await fs.unlink(req.file.path).catch(() => {});
        }
        
        console.error("To'lov yaratishda xatolik:", err);
        res.status(400).json({
            success: false,
            message: err.message || "To'lovni qayta ishlashda xatolik yuz berdi"
        });
    }
});

// GET - Barcha to'lovlarni olish
router.get("/all", async (req, res) => {
    try {
        // Pagination uchun query parametrlar
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // To'lovlar sonini olish
        const countResult = await pool.query('SELECT COUNT(*) FROM course_payments');
        const totalCount = parseInt(countResult.rows[0].count);
        
        // To'lovlarni olish
        const result = await pool.query(`
            SELECT 
                id,
                transaction_id,
                timestamp,
                status,
                full_name,
                telegram_username,
                phone_number,
                registration_date,
                course_start_date,
                course_time_slot,
                course_days,
                plan_name,
                plan_price,
                payment_date,
                receipt_filename,
                created_at,
                updated_at
            FROM course_payments 
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Natijalarni formatlash
        const payments = result.rows.map(payment => ({
            ...payment,
            receipt_url: payment.receipt_filename 
                ? `/api/payment-page/receipt/${payment.id}` 
                : null,
            formatted_created_at: new Date(payment.created_at)
                .toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
            formatted_payment_date: new Date(payment.payment_date)
                .toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
            formatted_course_start_date: new Date(payment.course_start_date)
                .toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })
        }));
        
        // Pagination ma'lumotlarini hisoblash
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        
        // Javobni qaytarish
        res.json({
            success: true,
            data: {
                payments,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount,
                    hasNextPage,
                    hasPrevPage,
                    limit
                }
            },
            message: "To'lovlar muvaffaqiyatli olindi"
        });
        
    } catch (err) {
        console.error("To'lovlarni olishda xatolik:", err);
        res.status(500).json({
            success: false,
            error: {
                code: "PAYMENTS_FETCH_ERROR",
                message: "To'lovlar ro'yxatini olishda xatolik yuz berdi",
                details: process.env.NODE_ENV === 'development' ? err.message : null
            }
        });
    }
});

// GET - Get user's course payments by phone number
router.get("/user/:phoneNumber", async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        
        const result = await pool.query(`
            SELECT 
                id, transaction_id, timestamp, status,
                full_name, telegram_username, phone_number,
                course_start_date, course_time_slot, course_days,
                plan_name, plan_price, payment_date,
                receipt_filename, created_at
            FROM course_payments 
            WHERE phone_number = $1
            ORDER BY created_at DESC
        `, [phoneNumber]);
        
        // Add receipt URL and format dates
        const payments = result.rows.map(payment => ({
            ...payment,
            receipt_url: payment.receipt_filename ? `/api/payment-page/receipt/${payment.id}` : null,
            formatted_created_at: new Date(payment.created_at).toLocaleString('uz-UZ'),
            formatted_payment_date: new Date(payment.payment_date).toLocaleString('uz-UZ'),
            formatted_course_start_date: new Date(payment.course_start_date).toLocaleDateString('uz-UZ')
        }));
        
        res.json({
            success: true,
            count: payments.length,
            payments
        });
        
    } catch (err) {
        console.error("Foydalanuvchi to'lovlarini olishda xatolik:", err);
        res.status(500).json({
            success: false,
            message: "Foydalanuvchi to'lovlari ro'yxatini olishda xatolik yuz berdi"
        });
    }
});

// GET - Get payment by transaction ID
router.get("/transaction/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const result = await pool.query(`
            SELECT * FROM course_payments 
            WHERE transaction_id = $1
        `, [transactionId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "To'lov topilmadi"
            });
        }
        
        // Add receipt URL and format dates
        const payment = {
            ...result.rows[0],
            receipt_url: result.rows[0].receipt_filename ? `/api/payment-page/receipt/${result.rows[0].id}` : null,
            formatted_created_at: new Date(result.rows[0].created_at).toLocaleString('uz-UZ'),
            formatted_payment_date: new Date(result.rows[0].payment_date).toLocaleString('uz-UZ'),
            formatted_course_start_date: new Date(result.rows[0].course_start_date).toLocaleDateString('uz-UZ')
        };
        
        res.json({
            success: true,
            payment
        });
        
    } catch (err) {
        console.error("To'lovni olishda xatolik:", err);
        res.status(500).json({
            success: false,
            message: "To'lov ma'lumotlarini olishda xatolik yuz berdi"
        });
    }
});

// GET - Serve receipt image
router.get("/receipt/:paymentId", async (req, res) => {
    try {
        const { paymentId } = req.params;
        
        // Get receipt file path from database
        const result = await pool.query(
            "SELECT receipt_filepath, receipt_filetype, receipt_filename FROM course_payments WHERE id = $1",
            [paymentId]
        );
        
        if (result.rows.length === 0 || !result.rows[0].receipt_filepath) {
            return res.status(404).json({
                success: false,
                message: "Chek topilmadi"
            });
        }
        
        const { receipt_filepath, receipt_filetype, receipt_filename } = result.rows[0];
        
        // Check if file exists
        try {
            await fs.access(receipt_filepath);
        } catch (error) {
            return res.status(404).json({
                success: false,
                message: "Chek fayli topilmadi"
            });
        }
        
        // Set response headers
        res.set({
            'Content-Type': receipt_filetype || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
            'Content-Disposition': `inline; filename="${receipt_filename}"`
        });
        
        // Send file
        res.sendFile(receipt_filepath);
        
    } catch (err) {
        console.error("Chekni yuklashda xatolik:", err);
        res.status(500).json({
            success: false,
            message: "Chekni yuklashda xatolik yuz berdi"
        });
    }
});

// PUT - Update payment status
router.put("/status/:paymentId", async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { paymentId } = req.params;
        const { status } = req.body;
        
        // Validate status
        if (!VALID_STATUSES.includes(status)) {
            throw new Error(`Noto'g'ri status qiymati. Ruxsat etilgan qiymatlar: ${VALID_STATUSES.join(', ')}`);
        }
        
        // Check if payment exists
        const checkResult = await client.query(
            "SELECT id FROM course_payments WHERE id = $1",
            [paymentId]
        );
        
        if (checkResult.rows.length === 0) {
            throw new Error("To'lov topilmadi");
        }
        
        // Update payment status
        const result = await client.query(
            `UPDATE course_payments 
             SET status = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 
             RETURNING *`,
            [status, paymentId]
        );
        
        await client.query('COMMIT');
        
        // Add receipt URL and format dates
        const payment = {
            ...result.rows[0],
            receipt_url: result.rows[0].receipt_filename ? `/api/payment-page/receipt/${result.rows[0].id}` : null,
            formatted_updated_at: new Date(result.rows[0].updated_at).toLocaleString('uz-UZ')
        };
        
        res.json({
            success: true,
            message: "To'lov holati muvaffaqiyatli yangilandi",
            payment
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        
        console.error("To'lov holatini yangilashda xatolik:", err);
        res.status(400).json({
            success: false,
            message: err.message || "To'lov holatini yangilashda xatolik yuz berdi"
        });
    } finally {
        client.release();
    }
});

// GET - Get payment statistics
router.get("/stats", async (req, res) => {
    try {
        // General statistics
        const generalStats = await pool.query(`
            SELECT 
                COUNT(*) as total_payments,
                COUNT(CASE WHEN status = 'success' OR status = 'completed' THEN 1 END) as successful_payments,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_payments,
                COUNT(CASE WHEN status = 'failed' OR status = 'rejected' THEN 1 END) as failed_payments,
                COUNT(DISTINCT phone_number) as unique_users
            FROM course_payments
        `);
        
        // Plan statistics
        const planStats = await pool.query(`
            SELECT 
                plan_name,
                COUNT(*) as count,
                COUNT(CASE WHEN status = 'success' OR status = 'completed' THEN 1 END) as successful_count
            FROM course_payments
            GROUP BY plan_name
            ORDER BY count DESC
        `);
        
        // Time slot statistics
        const timeSlotStats = await pool.query(`
            SELECT 
                course_time_slot,
                COUNT(*) as count
            FROM course_payments
            GROUP BY course_time_slot
            ORDER BY count DESC
        `);
        
        // Course days statistics
        const courseDaysStats = await pool.query(`
            SELECT 
                course_days,
                COUNT(*) as count
            FROM course_payments
            GROUP BY course_days
            ORDER BY count DESC
        `);
        
        res.json({
            success: true,
            general: generalStats.rows[0],
            plans: planStats.rows,
            timeSlots: timeSlotStats.rows,
            courseDays: courseDaysStats.rows
        });
        
    } catch (err) {
        console.error("To'lov statistikasini olishda xatolik:", err);
        res.status(500).json({
            success: false,
            message: "To'lov statistikasini olishda xatolik yuz berdi"
        });
    }
});

// DELETE - Delete payment (admin only)
router.delete("/:paymentId", async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { paymentId } = req.params;
        
        // Get payment details to delete file if exists
        const paymentResult = await client.query(
            "SELECT receipt_filepath FROM course_payments WHERE id = $1",
            [paymentId]
        );
        
        if (paymentResult.rows.length === 0) {
            throw new Error("To'lov topilmadi");
        }
        
        const { receipt_filepath } = paymentResult.rows[0];
        
        // Delete payment from database
        await client.query(
            "DELETE FROM course_payments WHERE id = $1",
            [paymentId]
        );
        
        await client.query('COMMIT');
        
        // Delete receipt file if exists
        if (receipt_filepath) {
            try {
                await fs.access(receipt_filepath);
                await fs.unlink(receipt_filepath);
            } catch (error) {
                console.warn("Chek faylini o'chirishda xatolik:", error);
            }
        }
        
        res.json({
            success: true,
            message: "To'lov muvaffaqiyatli o'chirildi"
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        
        console.error("To'lovni o'chirishda xatolik:", err);
        res.status(400).json({
            success: false,
            message: err.message || "To'lovni o'chirishda xatolik yuz berdi"
        });
    } finally {
        client.release();
    }
});

export default router;