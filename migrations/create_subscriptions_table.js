import pool from '../db/index.js';

const createSubscriptionsTable = async () => {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        payment_id INTEGER NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        plan_name VARCHAR(100) NOT NULL,
        plan_price VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_payment FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT check_dates CHECK (end_date > start_date)
      );
    `;

    await pool.query(createTableQuery);
    console.log('Subscriptions table created successfully');
  } catch (error) {
    console.error('Error creating subscriptions table:', error);
    throw error;
  }
};

export default createSubscriptionsTable;