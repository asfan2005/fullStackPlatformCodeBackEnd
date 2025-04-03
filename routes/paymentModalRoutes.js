import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import pool from '../db/index.js';

const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/receipts';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueFileName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFileName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Faqat rasm fayllari qabul qilinadi'));
    }
  }
});

// Handle receipt image upload
router.post('/upload-receipt', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: true,
        message: 'Rasm yuklanmadi'
      });
    }

    res.json({
      success: true,
      message: 'Rasm muvaffaqiyatli yuklandi',
      data: {
        fileName: req.file.filename,
        path: req.file.path
      }
    });
  } catch (error) {
    console.error('Rasm yuklashda xatolik:', error);
    res.status(500).json({
      error: true,
      message: 'Rasmni yuklashda xatolik yuz berdi'
    });
  }
});

// Create new payment with receipt and initial status
router.post('/create', upload.single('receipt'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Parse payment data from request body
    let paymentData;
    try {
      paymentData = JSON.parse(req.body.paymentData);
      
    } catch (error) {
      console.error('Error parsing payment data:', error);
      throw new Error('To\'lov ma\'lumotlarini qayta ishlashda xatolik');
    }
    
    const fileName = req.file ? req.file.filename : null;
    
    // Validate required fields
    const requiredFields = ['email', 'phone'];
    const missingFields = requiredFields.filter(field => !paymentData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Quyidagi maydonlar to'ldirilishi shart: ${missingFields.join(', ')}`);
    }

    const {
      additionalAmount = 0,
      baseAmount = 0,
      finalAmount = 0,
      subscriptionType = 'monthly',
      discounts = { promo: 'Yo\'q', yearly: 'Yo\'q' },
      address = '',
      email,
      passport = '',
      phone = '',
      courses = []
    } = paymentData;

    // Generate transaction ID
    const transaction_id = `TX-${uuidv4().substring(0, 8).toUpperCase()}`;

    const query = `
      INSERT INTO payment_modal (
        transaction_id,
        file_name,
        additional_amount,
        base_amount,
        final_amount,
        subscription_type,
        promo_discount,
        yearly_discount,
        address,
        email,
        passport,
        phone,
        courses,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      transaction_id,
      fileName,
      additionalAmount || 0,
      baseAmount || 0,
      finalAmount || 0,
      subscriptionType || 'monthly',
      discounts?.promo || 'Yo\'q',
      discounts?.yearly || 'Yo\'q',
      address || '',
      email,
      passport || '',
      phone || '',
      JSON.stringify(courses || []),
      'pending' // Boshlang'ich status - kutilmoqda
    ];

    console.log('Inserting payment with values:', values);
    const result = await client.query(query, values);
    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'To\'lov muvaffaqiyatli saqlandi',
      data: {
        transaction_id: result.rows[0].transaction_id,
        status: result.rows[0].status
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('To\'lovni saqlashda xatolik:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'To\'lovni saqlashda xatolik yuz berdi'
    });
  } finally {
    client.release();
  }
});

// GET: Get all payments with pagination and filtering
router.get('/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Build query conditions
    let conditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (searchTerm) {
      conditions.push(`(
        transaction_id ILIKE $${paramIndex} OR 
        email ILIKE $${paramIndex} OR 
        phone ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${searchTerm}%`);
      paramIndex++;
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      queryParams.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      queryParams.push(endDate);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM payment_modal ${whereClause}`;
    const totalCount = await pool.query(countQuery, queryParams);

    // Get paginated payments
    const query = `
      SELECT * FROM payment_modal 
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder} 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const queryParamsWithPagination = [...queryParams, limit, offset];
    const result = await pool.query(query, queryParamsWithPagination);

    res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.rows[0].count / limit),
        totalItems: parseInt(totalCount.rows[0].count),
        itemsPerPage: limit
      },
      filters: {
        search: searchTerm,
        startDate,
        endDate,
        sortBy,
        sortOrder
      }
    });

  } catch (error) {
    console.error('To\'lovlarni olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'To\'lovlarni olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// GET: Get payment statistics
router.get('/statistics', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // Get total payments count
      const totalCountQuery = 'SELECT COUNT(*) FROM payment_modal';
      const totalCount = await client.query(totalCountQuery);
      
      // Get total amount
      const totalAmountQuery = 'SELECT SUM(final_amount) FROM payment_modal';
      const totalAmount = await client.query(totalAmountQuery);
      
      // Get today's payments
      const todayQuery = `
        SELECT COUNT(*), SUM(final_amount) 
        FROM payment_modal 
        WHERE created_at::date = CURRENT_DATE
      `;
      const todayStats = await client.query(todayQuery);
      
      // Get payments by subscription type
      const subscriptionQuery = `
        SELECT subscription_type, COUNT(*) 
        FROM payment_modal 
        GROUP BY subscription_type
      `;
      const subscriptionStats = await client.query(subscriptionQuery);
      
      // Get payments by month (last 6 months)
      const monthlyQuery = `
        SELECT 
          DATE_TRUNC('month', created_at) AS month,
          COUNT(*) AS count,
          SUM(final_amount) AS total
        FROM payment_modal
        WHERE created_at > CURRENT_DATE - INTERVAL '6 months'
        GROUP BY month
        ORDER BY month DESC
      `;
      const monthlyStats = await client.query(monthlyQuery);
      
      res.status(200).json({
        success: true,
        data: {
          totalPayments: parseInt(totalCount.rows[0].count),
          totalAmount: parseFloat(totalAmount.rows[0].sum || 0),
          today: {
            count: parseInt(todayStats.rows[0].count),
            amount: parseFloat(todayStats.rows[0].sum || 0)
          },
          subscriptionTypes: subscriptionStats.rows.map(row => ({
            type: row.subscription_type,
            count: parseInt(row.count)
          })),
          monthlyStats: monthlyStats.rows.map(row => ({
            month: row.month,
            count: parseInt(row.count),
            total: parseFloat(row.total)
          }))
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Statistikani olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'Statistikani olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// GET: Get payment details by transaction ID with related data
router.get('/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT * FROM payment_modal 
      WHERE transaction_id = $1
    `;
    
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'To\'lov topilmadi'
      });
    }

    // Get payment data
    const payment = result.rows[0];
    
    // Format the response
    const formattedPayment = {
      ...payment,
      courses: typeof payment.courses === 'string' ? JSON.parse(payment.courses) : payment.courses,
      created_at: new Date(payment.created_at).toLocaleString('uz-UZ'),
      receipt_url: payment.file_name ? `/uploads/receipts/${payment.file_name}` : null
    };

    res.status(200).json({
      success: true,
      data: formattedPayment
    });

  } catch (error) {
    console.error('To\'lovni olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'To\'lovni olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// GET: Get payments by user email with pagination
router.get('/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get total count for user
    const countQuery = 'SELECT COUNT(*) FROM payment_modal WHERE email = $1';
    const totalCount = await pool.query(countQuery, [email]);

    // Get paginated payments for user
    const query = `
      SELECT * FROM payment_modal 
      WHERE email = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [email, limit, offset]);

    // Format the response
    const formattedPayments = result.rows.map(payment => ({
      ...payment,
      courses: typeof payment.courses === 'string' ? JSON.parse(payment.courses) : payment.courses,
      created_at: new Date(payment.created_at).toLocaleString('uz-UZ'),
      receipt_url: payment.file_name ? `/uploads/receipts/${payment.file_name}` : null
    }));

    res.status(200).json({
      success: true,
      data: formattedPayments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.rows[0].count / limit),
        totalItems: parseInt(totalCount.rows[0].count),
        itemsPerPage: limit
      }
    });

  } catch (error) {
    console.error('Foydalanuvchi to\'lovlarini olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'Foydalanuvchi to\'lovlarini olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// GET: Get receipt image
router.get('/receipt/:fileName', (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = path.join(process.cwd(), 'uploads/receipts', fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Rasm topilmadi'
      });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    console.error('Rasmni olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'Rasmni olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// GET: Export payments to CSV
router.get('/export', async (req, res) => {
  try {
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    
    // Build query conditions
    let conditions = [];
    let queryParams = [];
    
    if (startDate) {
      conditions.push('created_at >= $1');
      queryParams.push(startDate);
    }
    
    if (endDate) {
      conditions.push(`created_at <= $${queryParams.length + 1}`);
      queryParams.push(endDate);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get payments
    const query = `
      SELECT 
        transaction_id,
        email,
        phone,
        final_amount,
        subscription_type,
        created_at
      FROM payment_modal 
      ${whereClause}
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, queryParams);
    
    // Create CSV content
    let csvContent = 'Transaction ID,Email,Phone,Amount,Subscription Type,Date\n';
    
    result.rows.forEach(row => {
      const date = new Date(row.created_at).toLocaleString('uz-UZ');
      csvContent += `${row.transaction_id},${row.email},${row.phone},${row.final_amount},${row.subscription_type},${date}\n`;
    });
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=payments-${new Date().toISOString().slice(0, 10)}.csv`);
    
    res.send(csvContent);
    
  } catch (error) {
    console.error('To\'lovlarni eksport qilishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'To\'lovlarni eksport qilishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// Update payment status (for admin)
router.put('/status/:transactionId', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { transactionId } = req.params;
    const { status, adminComment } = req.body;
    
    // Validate status
    const validStatuses = ['pending', 'approved', 'rejected', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri status qiymati'
      });
    }
    
    await client.query('BEGIN');
    
    // Check if payment exists
    const checkQuery = 'SELECT * FROM payment_modal WHERE transaction_id = $1';
    const checkResult = await client.query(checkQuery, [transactionId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'To\'lov topilmadi'
      });
    }
    
    // Update payment status
    const updateQuery = `
      UPDATE payment_modal 
      SET 
        status = $1, 
        admin_comment = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE transaction_id = $3
      RETURNING *
    `;
    
    const updateResult = await client.query(updateQuery, [
      status, 
      adminComment || null, 
      transactionId
    ]);
    
    await client.query('COMMIT');
    
    // Format the response
    const payment = updateResult.rows[0];
    const formattedPayment = {
      ...payment,
      courses: typeof payment.courses === 'string' ? JSON.parse(payment.courses) : payment.courses,
      created_at: new Date(payment.created_at).toLocaleString('uz-UZ'),
      updated_at: new Date(payment.updated_at).toLocaleString('uz-UZ'),
      receipt_url: payment.file_name ? `/uploads/receipts/${payment.file_name}` : null
    };
    
    res.status(200).json({
      success: true,
      message: `To'lov statusi muvaffaqiyatli yangilandi: ${status}`,
      data: formattedPayment
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('To\'lov statusini yangilashda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'To\'lov statusini yangilashda xatolik yuz berdi',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Get payments by status with pagination
router.get('/by-status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    // Validate status
    const validStatuses = ['pending', 'approved', 'rejected', 'refunded', 'all'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri status qiymati'
      });
    }
    
    // Build query
    let whereClause = '';
    let queryParams = [];
    
    if (status !== 'all') {
      whereClause = 'WHERE status = $1';
      queryParams.push(status);
    }
    
    // Get total count
    const countQuery = `SELECT COUNT(*) FROM payment_modal ${whereClause}`;
    const totalCount = await pool.query(countQuery, queryParams);
    
    // Get paginated payments
    const query = `
      SELECT * FROM payment_modal 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    
    const result = await pool.query(query, [...queryParams, limit, offset]);
    
    // Format the response
    const formattedPayments = result.rows.map(payment => ({
      ...payment,
      courses: typeof payment.courses === 'string' ? JSON.parse(payment.courses) : payment.courses,
      created_at: new Date(payment.created_at).toLocaleString('uz-UZ'),
      updated_at: payment.updated_at ? new Date(payment.updated_at).toLocaleString('uz-UZ') : null,
      receipt_url: payment.file_name ? `/uploads/receipts/${payment.file_name}` : null
    }));
    
    res.status(200).json({
      success: true,
      data: formattedPayments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.rows[0].count / limit),
        totalItems: parseInt(totalCount.rows[0].count),
        itemsPerPage: limit
      }
    });
    
  } catch (error) {
    console.error('To\'lovlarni olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'To\'lovlarni olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

// Get payment status counts
router.get('/status-counts', async (req, res) => {
  try {
    const query = `
      SELECT 
        status, 
        COUNT(*) as count,
        SUM(final_amount) as total_amount
      FROM payment_modal 
      GROUP BY status
    `;
    
    const result = await pool.query(query);
    
    // Create a complete status map with all possible statuses
    const statusCounts = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 }
    };
    
    // Fill in actual counts
    result.rows.forEach(row => {
      statusCounts[row.status] = {
        count: parseInt(row.count),
        amount: parseFloat(row.total_amount || 0)
      };
    });
    
    res.status(200).json({
      success: true,
      data: statusCounts
    });
    
  } catch (error) {
    console.error('Status statistikasini olishda xatolik:', error);
    res.status(500).json({
      success: false,
      message: 'Status statistikasini olishda xatolik yuz berdi',
      error: error.message
    });
  }
});

export default router;