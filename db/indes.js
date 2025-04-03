import pg from 'pg';
const { Pool } = pg;

// PostgreSQL ulanish
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT,
});

// Users jadvalini yaratish uchun SQL
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firstname VARCHAR(100),
        lastname VARCHAR(100)
    )
`;

// Jadval yaratish
pool.query(createTableQuery)
    .catch(err => console.error("Jadval yaratishda xatolik:", err));

export default pool;