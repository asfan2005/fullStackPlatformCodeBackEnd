import pool from '../db/index.js';

const createPaymentModalTable = async () => {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS payment_modal (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(255) UNIQUE NOT NULL,
        file_name VARCHAR(255),
        additional_amount INTEGER DEFAULT 0,
        base_amount INTEGER NOT NULL,
        final_amount INTEGER NOT NULL,
        subscription_type VARCHAR(50) NOT NULL,
        promo_discount VARCHAR(50),
        yearly_discount VARCHAR(50),
        address TEXT,
        email VARCHAR(255) NOT NULL,
        passport VARCHAR(50),
        phone VARCHAR(50) NOT NULL,
        courses JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await pool.query(createTableQuery);
    console.log('Payment modal table created successfully');

    // Create index for faster searches
    const createIndexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_payment_modal_email ON payment_modal(email)',
      'CREATE INDEX IF NOT EXISTS idx_payment_modal_transaction_id ON payment_modal(transaction_id)',
      'CREATE INDEX IF NOT EXISTS idx_payment_modal_created_at ON payment_modal(created_at)'
    ];

    for (const query of createIndexQueries) {
      await pool.query(query);
    }
    console.log('Payment modal indices created successfully');

  } catch (error) {
    console.error('Error creating payment modal table:', error);
    throw error;
  }
};

export default createPaymentModalTable;