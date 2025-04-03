ALTER TABLE messages
ADD COLUMN reply_to_message_id INT REFERENCES messages(id) ON DELETE CASCADE;
