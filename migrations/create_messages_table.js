import pool from '../db/index.js';

const createMessagesTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        time VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    await pool.query(query);
    console.log('Messages table created successfully');
    
    return true;
  } catch (error) {
    console.error('Error creating messages table:', error);
    throw error;
  }
};

export default createMessagesTable;