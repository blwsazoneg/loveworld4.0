
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const users = [
    {
        username: 'admin',
        email: 'admin@loveworld.com',
        password: 'password123',
        role: 'Admin',
        first_name: 'Admin',
        last_name: 'User',
        phone_number: '1234567890',
        date_of_birth: '1990-01-01'
    },
    {
        username: 'testuser',
        email: 'user@loveworld.com',
        password: 'password123',
        role: 'User',
        first_name: 'Test',
        last_name: 'User',
        phone_number: '0987654321',
        date_of_birth: '1995-05-05'
    }
];

const products = [
    { name: 'Classic T-Shirt', price: 25.00, description: 'A comfortable classic t-shirt.' },
    { name: 'LoveWorld Hoodie', price: 55.00, description: 'Warm hoodie with logo.' },
    { name: 'Journal', price: 15.00, description: 'Hardcover journal for notes.' },
    { name: 'Water Bottle', price: 20.00, description: 'Stainless steel water bottle.' },
    { name: 'Cap', price: 18.00, description: 'Stylish baseball cap.' },
    { name: 'Pen Set', price: 12.00, description: 'Luxury pen set.' },
    { name: 'Tote Bag', price: 10.00, description: 'Eco-friendly tote bag.' },
    { name: 'Study Bible', price: 45.00, description: 'Comprehensive study bible.' },
    { name: 'Anointing Oil', price: 30.00, description: 'Premium anointing oil.' },
    { name: 'Wristband', price: 5.00, description: 'Rubber wristband.' },
    { name: 'Coffee Mug', price: 12.00, description: 'Ceramic coffee mug.' },
    { name: 'Sticker Pack', price: 8.00, description: 'Assorted stickers.' }
];

async function seed() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE
        });

        console.log('Connected to database.');

        // 1. Seed Users
        let sboUserId = null;
        for (const user of users) {
            const [existing] = await connection.execute('SELECT id FROM users WHERE email = ?', [user.email]);
            let userId;
            if (existing.length === 0) {
                const hashedPassword = await bcrypt.hash(user.password, 10);
                const [result] = await connection.execute(
                    `INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone_number, date_of_birth) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.username, user.email, hashedPassword, user.role, user.first_name, user.last_name, user.phone_number, user.date_of_birth]
                );
                userId = result.insertId;
                console.log(`Created user: ${user.username}`);
            } else {
                console.log(`User already exists: ${user.username}`);
                userId = existing[0].id;
            }
            if (user.role === 'User') sboUserId = userId; // Use the 'User' role as SBO
        }

        // Ensure we have an SBO ID
        if (!sboUserId) {
            const [u] = await connection.execute("SELECT id FROM users WHERE role='User' LIMIT 1");
            if (u.length > 0) sboUserId = u[0].id;
            else {
                const [a] = await connection.execute("SELECT id FROM users LIMIT 1");
                if (a.length > 0) sboUserId = a[0].id;
            }
        }
        if (!sboUserId) throw new Error("No user found to assign sbo_id");
        console.log(`Using SBO ID: ${sboUserId}`);

        // 2. Seed Hero Slides
        const [slides] = await connection.execute('SELECT count(*) as count FROM hero_slides');
        if (slides[0].count === 0) {
            await connection.execute(
                `INSERT INTO hero_slides (title_text, subtitle_text, background_image_url, display_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                ['Welcome to LoveWorld', 'Experience the glory', 'https://via.placeholder.com/1920x1080', 1, 1]
            );
            console.log('Seeded Hero Slide');
        }

        // 3. Seed Products
        const [cats] = await connection.execute('SELECT * FROM sectors LIMIT 1');
        let sectorId = null;
        if (cats.length > 0) {
            sectorId = cats[0].id;
        } else {
            const [res] = await connection.execute("INSERT INTO sectors (name, is_featured) VALUES ('General', 1)");
            sectorId = res.insertId;
        }

        for (const [i, prod] of products.entries()) {
            const [existing] = await connection.execute('SELECT id FROM products WHERE name = ?', [prod.name]);
            let prodId;
            if (existing.length === 0) {
                const date = new Date();
                date.setDate(date.getDate() - i);

                const [result] = await connection.execute(
                    `INSERT INTO products (name, description, price, stock_quantity, sector_id, sbo_id, is_active, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [prod.name, prod.description, prod.price, 100, sectorId, sboUserId, 1, date]
                );
                prodId = result.insertId;
                console.log(`Created product: ${prod.name}`);
            } else {
                console.log(`Product already exists: ${prod.name}`);
                prodId = existing[0].id;
            }

            // Seed Image (Fixed: removed is_primary)
            const [imgs] = await connection.execute('SELECT * FROM product_images WHERE product_id = ?', [prodId]);
            if (imgs.length === 0) {
                await connection.execute(
                    `INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)`,
                    [prodId, 'https://via.placeholder.com/400x400', 0]
                );
            }
        }

        console.log('Seeding complete.');
        process.exit();

    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
}

seed();
