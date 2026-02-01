
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE
        });

        console.log("Connected to database.");

        try {
            await connection.query("ALTER TABLE orders ADD COLUMN stripe_session_id VARCHAR(255)");
            console.log("Added stripe_session_id column to orders table.");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("stripe_session_id column already exists.");
            else console.log("Error adding stripe_session_id: " + e.message);
        }

    } catch (e) {
        console.error("Script failed:", e);
    } finally {
        if (connection) await connection.end();
    }
}

run();
