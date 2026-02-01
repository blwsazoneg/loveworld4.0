
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        port: process.env.DB_PORT || 3306,
        multipleStatements: true // Allow executing multiple SQL statements at once
    });

    try {
        console.log('Connected to MySQL server.');

        // Read the schema file
        // Assuming the schema file is in the same directory or specific path.
        // I will copy the schema content here or read it from a known location.
        // Since I cannot easily read from the artifact directory programmatically without absolute path which might vary,
        // I will assume the user has placed 'mysql_schema.sql' in the root or I will write it there first.
        // Actually, the artifact is at C:\Users\user\.gemini\antigravity\brain\...\mysql_schema.sql
        // I will read it from there if possible, or I will write it to the project root now.

        const schemaPath = path.join(__dirname, 'mysql_schema.sql');

        if (!fs.existsSync(schemaPath)) {
            console.error(`Schema file not found at ${schemaPath}`);
            process.exit(1);
        }

        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Executing schema...');
        await connection.query(schemaSql);
        console.log('Schema executed successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await connection.end();
    }
}

migrate();
