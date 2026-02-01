
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function repairSchema() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        port: process.env.DB_PORT || 3306,
        database: process.env.DB_DATABASE || 'loveworld_db'
    });

    try {
        console.log('Connected to MySQL server.');

        // Add columns if they don't exist.
        // There is no easy "ADD COLUMN IF NOT EXISTS" in standard MySQL prior to 8.0.29 (ish),
        // but since we know they are missing, we can try adding them.
        // If they exist, it will error, which we can catch/ignore.

        const alterQueries = [
            "ALTER TABLE users ADD COLUMN kingschat_access_token TEXT",
            "ALTER TABLE users ADD COLUMN kingschat_refresh_token TEXT"
        ];

        for (const query of alterQueries) {
            try {
                await connection.query(query);
                console.log(`Executed: ${query}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`Column already exists (skipped): ${query}`);
                } else {
                    console.error(`Failed to execute: ${query}`, err.message);
                }
            }
        }

        console.log('Schema repair completed.');

    } catch (error) {
        console.error('Repair failed:', error);
    } finally {
        await connection.end();
    }
}

repairSchema();
