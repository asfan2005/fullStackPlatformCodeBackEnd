import pool from '../db/index.js';

const addStatusToPaymentModal = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if status column already exists
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_modal' AND column_name = 'status'
    `;
    
    const checkResult = await client.query(checkColumnQuery);
    
    if (checkResult.rows.length === 0) {
      // Add status column with default value 'pending'
      const addColumnQuery = `
        ALTER TABLE payment_modal 
        ADD COLUMN status VARCHAR(50) DEFAULT 'pending' NOT NULL;
      `;
      await client.query(addColumnQuery);
      console.log('Status column added to payment_modal table');
      
      // Add admin_comment column
      const addCommentColumnQuery = `
        ALTER TABLE payment_modal 
        ADD COLUMN admin_comment TEXT DEFAULT NULL;
      `;
      await client.query(addCommentColumnQuery);
      console.log('Admin comment column added to payment_modal table');
      
      // Add updated_at column
      const addUpdatedAtColumnQuery = `
        ALTER TABLE payment_modal 
        ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      `;
      await client.query(addUpdatedAtColumnQuery);
      console.log('Updated_at column added to payment_modal table');
      
      // Create index on status column for faster queries
      const createIndexQuery = `
        CREATE INDEX idx_payment_modal_status ON payment_modal(status);
      `;
      await client.query(createIndexQuery);
      console.log('Index created on status column');
    } else {
      console.log('Status column already exists in payment_modal table');
    }
    
    await client.query('COMMIT');
    console.log('Migration completed successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding status column to payment_modal table:', error);
    throw error;
  } finally {
    client.release();
  }
};

export default addStatusToPaymentModal; 