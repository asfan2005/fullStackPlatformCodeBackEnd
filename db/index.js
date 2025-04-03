import pg from 'pg';
const { Pool } = pg;

let pool;

try {
    // PostgreSQL ulanish
    pool = new Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'fullstack_db',
        password: process.env.DB_PASS || 'postgres',
        port: process.env.DB_PORT || 5432,
    });

    // Ma'lumotlar bazasi ulanishini tekshirish
    pool.connect()
        .then(() => console.log('Database connected successfully'))
        .catch(err => {
            console.error('Database connection error:', err);
            console.log('Application will continue without database functionality');
        });
} catch (error) {
    console.error('Database pool creation error:', error);
    console.log('Creating dummy pool for development...');
    // Development uchun stub/dummy pool
    pool = {
        query: () => Promise.resolve({ rows: [] }),
        connect: () => Promise.resolve(),
    };
}

export default pool; 