
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

        // 1. Add Columns to sbo_profiles
        try {
            await connection.query("ALTER TABLE sbo_profiles ADD COLUMN contact_phone VARCHAR(50)");
            console.log("Added contact_phone column.");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("contact_phone column already exists.");
            else console.log("Error adding contact_phone: " + e.message);
        }

        try {
            await connection.query("ALTER TABLE sbo_profiles ADD COLUMN contact_email VARCHAR(255)");
            console.log("Added contact_email column.");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("contact_email column already exists.");
            else console.log("Error adding contact_email: " + e.message);
        }

        try {
            await connection.query("ALTER TABLE sbo_profiles ADD COLUMN status VARCHAR(50) DEFAULT 'pending'");
            console.log("Added status column.");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("status column already exists.");
            else console.log("Error adding status column: " + e.message);
        }

        // 2. Identify SBO User from Products
        const [products] = await connection.query("SELECT DISTINCT sbo_id FROM products WHERE sbo_id IS NOT NULL LIMIT 1");
        if (products.length === 0) {
            console.log("No products found with an sbo_id. Please seed products first.");
            return;
        }

        const sboUserId = products[0].sbo_id;
        console.log(`Found SBO User ID: ${sboUserId}`);

        // 3. Find or Create SBO Profile
        const [profiles] = await connection.query("SELECT id FROM sbo_profiles WHERE user_id = ?", [sboUserId]);
        let profileId;

        const contactPhone = '+1 (234) 567-8900';
        const contactEmail = 'support@loveworldmerch.com';
        const companyName = 'LoveWorld Official Store';

        if (profiles.length === 0) {
            const [res] = await connection.query(`
                INSERT INTO sbo_profiles (user_id, company_name, contact_phone, contact_email, status) 
                VALUES (?, ?, ?, ?, 'approved')
            `, [sboUserId, companyName, contactPhone, contactEmail]);
            profileId = res.insertId;
            console.log(`Created new SBO Profile (ID: ${profileId})`);
        } else {
            profileId = profiles[0].id;
            await connection.query(`
                UPDATE sbo_profiles 
                SET contact_phone = ?, contact_email = ?, company_name = ? 
                WHERE id = ?
            `, [contactPhone, contactEmail, companyName, profileId]);
            console.log(`Updated existing SBO Profile (ID: ${profileId})`);
        }

        // 4. Update Products to link to this Profile
        const [updateRes] = await connection.query("UPDATE products SET sbo_profile_id = ? WHERE sbo_id = ?", [profileId, sboUserId]);
        console.log(`Updated ${updateRes.changedRows} products to link to SBO Profile ID ${profileId}.`);

    } catch (e) {
        console.error("Script failed:", e);
    } finally {
        if (connection) await connection.end();
    }
}

run();
