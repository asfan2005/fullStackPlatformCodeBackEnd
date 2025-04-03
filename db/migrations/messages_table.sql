DROP TABLE IF EXISTS messages CASCADE;

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    user_id INT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reply_to_message_id INT,
    read BOOLEAN DEFAULT false,
    to_user_id INT,
    CONSTRAINT fk_reply_to_message 
        FOREIGN KEY (reply_to_message_id) 
        REFERENCES messages(id) 
        ON DELETE CASCADE
);
