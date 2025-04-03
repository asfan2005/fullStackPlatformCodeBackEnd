// backEndFullStack/migrations/create_payments_table.js
import pool from '../db/index.js';

const createPaymentsTable = async () => {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(100) UNIQUE NOT NULL,
        user_id INTEGER,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
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

    await pool.query(createTableQuery);
    console.log('Payments table created successfully');
  } catch (error) {
    console.error('Error creating payments table:', error);
    throw error;
  }
};

export default createPaymentsTable;