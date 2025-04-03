-- Check if columns don't exist before adding them
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'time') THEN
    ALTER TABLE messages ADD COLUMN time TIMESTAMP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'reply_to_message_id') THEN
    ALTER TABLE messages ADD COLUMN reply_to_message_id INT REFERENCES messages(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'created_at') THEN
    ALTER TABLE messages ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;
