import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import usersRouter from './routes/users.js';
import paymentsRouter from './routes/payments.js';
import messagesRouter from './routes/messagesRoutes.js';
import pool from './db/index.js';
import createPaymentsTable from './migrations/create_payments_table.js';
import createSubscriptionsTable from './migrations/create_subscriptions_table.js';
import createPaymentModalTable from './migrations/createPaymentModalTable.js';
import addStatusToPaymentModal from './migrations/addStatusToPaymentModal.js';
import createMessagesTable from './migrations/create_messages_table.js';
import paymentPageRouter from "./routes/paymentPage.js";
import paymentModalRoutes from "./routes/paymentModalRoutes.js"
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database jadvallarini yaratish
const initDatabase = async () => {
  try {
    await createPaymentsTable();
    await createSubscriptionsTable();
    await createPaymentModalTable();
    await addStatusToPaymentModal();
    await createMessagesTable();
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
};

// Database initialization
await initDatabase();

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Routes
app.use('/api/users', usersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/payment-page', paymentPageRouter)
app.use('/api/payment-modal', paymentModalRoutes)
app.use('/api/messages', messagesRouter)
// Health check
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      message: 'Server ishlayapti!'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Database xatosi'
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server xatoligi:', err);
  res.status(500).json({
    error: true,
    message: 'Server xatoligi yuz berdi'
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;





