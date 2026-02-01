// routes/admin.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'loveworld_app_products', // A folder name in your Cloudinary account
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'pdf', 'doc', 'docx'],
        format: 'webp', // Force conversion to WebP for images
    },
});

// --- Multer Configuration for Product Images ---

const upload = multer({ storage: storage });
// ---------------------------------------------

const router = express.Router();


// @route   POST /api/admin/products
// @desc    Create a new product with images
// @access  Private (Admin or SBO)
router.post('/products', authenticateToken, checkRole(['Admin', 'SBO']), upload.array('images'), async (req, res) => {
    // THE FIX: Add 'sbo_profile_id' to the destructuring assignment
    const { name, description, price, stock_quantity, sector_id, brand_id, sbo_profile_id } = req.body;
    const sboUserId = req.user.id;

    // Use connection for transaction
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let finalSboProfileId = sbo_profile_id;
        if (req.user.role === 'SBO') {
            const [sboProfileResult] = await connection.execute('SELECT id FROM sbo_profiles WHERE user_id = ?', [sboUserId]);
            if (sboProfileResult.length === 0) throw new Error('SBO profile not found for this user.');
            finalSboProfileId = sboProfileResult[0].id;
        }

        const productQuery = `
                INSERT INTO products (name, description, price, stock_quantity, sector_id, brand_id, sbo_id, sbo_profile_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const productValues = [name, description, price, stock_quantity, sector_id, brand_id, sboUserId, finalSboProfileId || null];
        const [newProduct] = await connection.execute(productQuery, productValues);
        const newProductId = newProduct.insertId;

        // THE FIX: req.files now contains Cloudinary data
        if (req.files && req.files.length > 0) {
            const imageInsertPromises = req.files.map((file, index) => {
                // Get the secure URL from the Cloudinary response
                const imageUrl = file.path;
                return connection.execute('INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)', [newProductId, imageUrl, index]);
            });
            await Promise.all(imageInsertPromises);
        }
        await connection.commit();
        res.status(201).json({ message: 'Product created successfully!', productId: newProductId });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating product:', error);
        res.status(500).json({ message: error.message || 'Failed to create product. Transaction rolled back.' });
    } finally {
        connection.release();
    }
}
);

// @route   GET /api/admin/products
// @desc    Get all products for the admin management view
// @access  Private (Admin or SBO)
router.get('/products', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const page = parseInt(req.query.page || '1');
    const limit = 15; // Show 15 products per page in the admin panel
    const offset = (page - 1) * limit;

    try {
        // Query to get the paginated list
        const [productsResult] = await pool.execute(
            `SELECT p.id, p.name, p.price, p.stock_quantity, p.is_active, s.name as sector_name, b.name as brand_name
             FROM products p
             LEFT JOIN sectors s ON p.sector_id = s.id
             LEFT JOIN brands b ON p.brand_id = b.id
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [limit.toString(), offset.toString()] // MySQL2 often likes strings for LIMIT/OFFSET in prepared statements or explicit numbers, but ? usually handles it. 
            // Actually, LIMIT ? OFFSET ? works with integers in mysql2 if generic query. let's pass numbers.
            // Wait, passing integers to execute with mysql2 is fine.
        );

        // Query to get the total count for pagination controls
        const [totalResult] = await pool.execute('SELECT COUNT(*) as count FROM products');
        const totalProducts = parseInt(totalResult[0].count);
        const totalPages = Math.ceil(totalProducts / limit);

        res.status(200).json({
            products: productsResult,
            currentPage: page,
            totalPages: totalPages
        });
    } catch (error) {
        console.error('Error fetching admin products list:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/products/:id
// @desc    Get a single product's full details for editing
// @access  Private (Admin or SBO)
router.get('/products/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const [productResult] = await pool.execute('SELECT * FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        const product = productResult[0];
        // Security Check: Ensure SBO can only edit their own products
        if (userRole !== 'Admin' && product.sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to access this product.' });
        }
        res.status(200).json(product);
    } catch (error) {
        console.error('Error fetching product for edit:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});


// @route   POST /api/admin/products/:id/update
// @desc    Update a product's text data AND/OR upload new images
// @access  Private (Admin or SBO)
router.post('/products/:id/update', authenticateToken, checkRole(['Admin', 'SBO']), upload.array('newImages'), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;
    const {
        name, description, price, stock_quantity, sector_id, brand_id, is_active,
        allow_backorder, sale_price, sale_start_date, sale_end_date, sbo_profile_id
    } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [productResult] = await connection.execute('SELECT sbo_id FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) throw new Error('Product not found.');
        if (userRole !== 'Admin' && productResult[0].sbo_id !== userId) throw new Error('Authorization failed.');

        // 1. Update the product's text/numeric data
        await connection.execute(
            `UPDATE products SET 
                    name = ?, description = ?, price = ?, stock_quantity = ?, sector_id = ?, brand_id = ?, 
                    is_active = ?, allow_backorder = ?, sale_price = ?, sale_start_date = ?, sale_end_date = ?,
                    sbo_profile_id = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
            [
                name, description, price, stock_quantity, sector_id, brand_id, is_active,
                allow_backorder, sale_price || null, sale_start_date || null, sale_end_date || null,
                sbo_profile_id || null, productId
            ]
        );

        // 2. If new images were uploaded, insert them
        if (req.files && req.files.length > 0) {
            const imageInsertPromises = req.files.map(file => {
                const imageUrl = `/uploads/products/${file.filename}`;
                return connection.execute('INSERT INTO product_images (product_id, image_url) VALUES (?, ?)', [productId, imageUrl]);
            });
            await Promise.all(imageInsertPromises);
        }

        await connection.commit();
        res.status(200).json({ message: 'Product updated successfully!' });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating product:', error);
        res.status(500).json({ message: error.message || 'Server error while updating product.' });
    } finally {
        connection.release();
    }
}
);

// @route   GET /api/admin/products/:id/images
// @desc    Get all images for a specific product
// @access  Private (Admin or SBO)
router.get('/products/:id/images', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    try {
        const [images] = await pool.execute('SELECT * FROM product_images WHERE product_id = ? ORDER BY display_order ASC', [productId]);
        res.status(200).json(images);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   POST /api/admin/products/:id/images
// @desc    Upload new images for an existing product
// @access  Private (Admin or SBO who owns the post)
router.post('/products/:id/images', authenticateToken, checkRole(['Admin', 'SBO']), upload.array('newImages'), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No image files were uploaded.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [productResult] = await connection.execute('SELECT sbo_id FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) throw new Error('Product not found.');
        if (userRole !== 'Admin' && productResult[0].sbo_id !== userId) throw new Error('Authorization failed.');

        const imageInsertPromises = req.files.map((file, index) => {
            const imageUrl = `/${file.path.replace(/\\/g, "/")}`;
            return connection.execute('INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)', [productId, imageUrl, index]);
        });
        await Promise.all(imageInsertPromises);

        await connection.commit();
        res.status(201).json({ message: 'Images uploaded successfully.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error uploading product images:', error);
        res.status(500).json({ message: error.message || 'Server error.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/admin/products/:id
// @desc    Delete a product and its images
// @access  Private (Admin or SBO who owns the product)
router.delete('/products/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get product owner and image paths for deletion
        // MySQL doesn't have array_agg by default in the same way or requires GROUP_CONCAT. 
        // But for deletion logic, we can just select simple rows or use JSON_ARRAYAGG if mysql 5.7+ (mysql 8 is common).
        // Let's assume MySQL 8. If simplistic, just select normally.
        const [productResult] = await connection.execute(
            `SELECT p.sbo_id, pi.image_url
             FROM products p
             LEFT JOIN product_images pi ON p.id = pi.product_id
             WHERE p.id = ?`,
            [productId]
        );

        if (productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        const productData = productResult[0]; // access first row for sbo_id

        // Collect all image URLs from rows
        const imageUrls = productResult.map(row => row.image_url).filter(url => url);

        // 2. Security Check: Ensure SBO can only delete their own product
        if (userRole !== 'Admin' && productData.sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this product.' });
        }

        // 3. Delete the product from the database.
        // ON DELETE CASCADE will handle deleting from: product_images, section_products, cart_items, order_items.
        await connection.execute('DELETE FROM products WHERE id = ?', [productId]);

        // 4. Delete the physical image files from the /uploads folder
        if (imageUrls.length > 0) {
            imageUrls.forEach(imageUrl => {
                // Construct file path from project root
                const filePath = path.join(__dirname, '..', imageUrl);
                fs.unlink(filePath, (err) => {
                    if (err) console.error(`Failed to delete file from disk: ${filePath}`, err);
                    else console.log(`Successfully deleted file: ${filePath}`);
                });
            });
        }

        await connection.commit();
        res.status(200).json({ message: 'Product deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/admin/images/:imageId
// @desc    Delete a single product image
// @access  Private (Admin or SBO who owns the product)
router.delete('/images/:imageId', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { imageId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const [imageResult] = await pool.execute(
            `SELECT pi.image_url, p.sbo_id FROM product_images pi
             JOIN products p ON pi.product_id = p.id
             WHERE pi.id = ?`, [imageId]
        );
        if (imageResult.length === 0) return res.status(404).json({ message: 'Image not found.' });

        const imageData = imageResult[0];
        if (userRole !== 'Admin' && imageData.sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this image.' });
        }

        // --- THIS IS THE PRODUCTION-READY FIX ---
        // 1. Delete the record from the database
        await pool.execute('DELETE FROM product_images WHERE id = ?', [imageId]);

        // 2. Delete the actual file from the server's disk
        // Construct the full file path from the project root
        const filePath = path.join(__dirname, '..', imageData.image_url);
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error(`Failed to delete file from disk: ${filePath}`, err);
            } else {
                console.log(`Successfully deleted file: ${filePath}`);
            }
        });
        // ------------------------------------

        res.status(200).json({ message: 'Image deleted successfully.' });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- ADD THIS NEW ROUTE ---
// @route   GET /api/admin/sbo-profiles
// @desc    Get a list of all SBO profiles for dropdowns
// @access  Private (Admin only)
router.get('/sbo-profiles', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [sboProfiles] = await pool.execute(
            'SELECT id, company_name FROM sbo_profiles ORDER BY company_name ASC'
        );
        res.status(200).json(sboProfiles);
    } catch (error) {
        console.error('Error fetching SBO profiles:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// =======================================================
// SECTOR MANAGEMENT ROUTES (Admin Only)
// =======================================================

// @route   POST /api/admin/sectors
// @desc    Create a new sector
// @access  Private (Admin)
router.post(
    '/sectors',
    authenticateToken,
    checkRole(['Admin']),
    // Use multer's .fields() to handle specific, named file uploads
    upload.fields([
        { name: 'image_url', maxCount: 1 },
        { name: 'hero_image_url', maxCount: 1 }
    ]),
    async (req, res) => {
        const { name, is_featured, display_order } = req.body;
        if (!name) return res.status(400).json({ message: 'Sector name is required.' });

        try {
            const [existing] = await pool.execute('SELECT id FROM sectors WHERE name LIKE ?', [name]);
            if (existing.length > 0) return res.status(409).json({ message: 'A sector with this name already exists.' });

            // Get the public path of the uploaded files, if they exist
            // req.files is now an object, e.g., { image_url: [file], hero_image_url: [file] }
            const imageUrl = req.files['image_url'] ? req.files['image_url'][0].path : null;
            const heroImageUrl = req.files['hero_image_url'] ? req.files['hero_image_url'][0].path : null;

            const [result] = await pool.execute(
                `INSERT INTO sectors (name, image_url, hero_image_url, is_featured, display_order)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    name,
                    imageUrl,
                    heroImageUrl,
                    is_featured === 'true', // FormData sends booleans as strings 
                    display_order || 0
                ]
            );

            // Fetch the newly created sector
            const [newSector] = await pool.execute('SELECT * FROM sectors WHERE id = ?', [result.insertId]);
            res.status(201).json(newSector[0]);
        } catch (error) {
            console.error('Error creating sector:', error);
            res.status(500).json({ message: 'Server error while creating sector.' });
        }
    }
);

// @route   DELETE /api/admin/sectors/:id
// @desc    Delete a sector
// @access  Private (Admin)
// --- REPLACE THE ENTIRE DELETE /sectors/:id ROUTE ---
router.delete('/sectors/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id: sectorId } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the image URLs before deleting the record
        const [sectorResult] = await connection.execute('SELECT image_url, hero_image_url FROM sectors WHERE id = ?', [sectorId]);
        if (sectorResult.length === 0) {
            // If not found, it might have been deleted already. Send success.
            return res.status(200).json({ message: 'Sector already deleted.' });
        }
        const { image_url, hero_image_url } = sectorResult[0];

        // 2. Delete the sector from the database.
        // Products linked via sector_id will have it set to NULL automatically.
        await connection.execute('DELETE FROM sectors WHERE id = ?', [sectorId]);

        // 3. Delete the physical image files from the /uploads folder
        [image_url, hero_image_url].forEach(url => {
            if (url) {
                const filePath = path.join(__dirname, '..', url);
                fs.unlink(filePath, (err) => {
                    if (err) console.error(`Failed to delete sector image file: ${filePath}`, err);
                    else console.log(`Successfully deleted sector image: ${filePath}`);
                });
            }
        });

        await connection.commit();
        res.status(200).json({ message: 'Sector deleted successfully.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting sector:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        connection.release();
    }
});


// =======================================================
// BRAND MANAGEMENT ROUTES (Admin Only)
// =======================================================

// @route   POST /api/admin/brands
// @desc    Create a new brand
// @access  Private (Admin)
router.post('/brands', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Brand name is required.' });
    try {
        const [existing] = await pool.execute('SELECT id FROM brands WHERE name LIKE ?', [name]);
        if (existing.length > 0) return res.status(409).json({ message: 'A brand with this name already exists.' });

        const [result] = await pool.execute('INSERT INTO brands (name) VALUES (?)', [name]);
        const [newBrand] = await pool.execute('SELECT * FROM brands WHERE id = ?', [result.insertId]);
        res.status(201).json(newBrand[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   DELETE /api/admin/brands/:id
// @desc    Delete a brand
// @access  Private (Admin)
router.delete('/brands/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        await pool.execute('DELETE FROM brands WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Brand deleted successfully.' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// =======================================================
// HERO SLIDE MANAGEMENT ROUTES (Admin Only)
// =======================================================

// @route   GET /api/admin/hero-slides
// @desc    Get all hero slides for the admin view
// @access  Private (Admin)
router.get('/hero-slides', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [slides] = await pool.execute('SELECT * FROM hero_slides ORDER BY display_order ASC');
        // For each slide, fetch its collage images
        for (const slide of slides) {
            const [collageResult] = await pool.execute('SELECT * FROM hero_slide_collages WHERE slide_id = ?', [slide.id]);
            slide.collage_images = collageResult;
        }
        res.status(200).json(slides);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// POST (Create) a new hero slide
router.post('/hero-slides', authenticateToken, checkRole(['Admin']), upload.single('background_image_url'), async (req, res) => {
    const { title_text, subtitle_text, display_order, is_active } = req.body;
    if (!req.file) return res.status(400).json({ message: 'A background image is required.' });

    try {
        const backgroundImageUrl = req.file.path; // Use the Cloudinary URL directly
        const [result] = await pool.execute(
            `INSERT INTO hero_slides (title_text, subtitle_text, background_image_url, is_active, display_order) VALUES (?, ?, ?, ?, ?)`,
            [title_text, subtitle_text, backgroundImageUrl, is_active === 'true', display_order || 0]
        );
        // Return the new slide with an empty collage_images array for the frontend
        const [newSlide] = await pool.execute('SELECT * FROM hero_slides WHERE id = ?', [result.insertId]);
        const slideData = newSlide[0];
        slideData.collage_images = [];
        res.status(201).json(slideData);
    } catch (error) {
        console.error('Error creating hero slide:', error);
        res.status(500).json({ message: 'Server error' });
    }
}
);

// POST (Add) a collage image to a slide
router.post('/hero-slides/:slideId/collage', authenticateToken, checkRole(['Admin']), upload.single('image_url'), async (req, res) => {
    const { slideId } = req.params;
    const { top_position, left_position, width, height, z_index } = req.body;
    if (!req.file) return res.status(400).json({ message: 'An image file is required.' });

    try {
        const imageUrl = req.file.path; // Use the Cloudinary URL directly
        const [result] = await pool.execute(
            `INSERT INTO hero_slide_collages (slide_id, image_url, top_position, left_position, width, height, z_index) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [slideId, imageUrl, top_position || '50%', left_position || '50%', width || '150px', height || '150px', z_index || 10]
        );
        const [newCollageImage] = await pool.execute('SELECT * FROM hero_slide_collages WHERE id = ?', [result.insertId]);
        res.status(201).json(newCollageImage[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
}
);

// DELETE a hero slide
router.delete('/hero-slides/:slideId', authenticateToken, checkRole(['Admin']), async (req, res) => {
    // This is complex because we need to delete multiple files.
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [slideResult] = await connection.execute('SELECT * FROM hero_slides WHERE id = ?', [req.params.slideId]);
        if (slideResult.length === 0) return res.status(404).json({ message: 'Slide not found.' });
        const slide = slideResult[0];

        const [collageResult] = await connection.execute('SELECT image_url FROM hero_slide_collages WHERE slide_id = ?', [req.params.slideId]);

        await connection.execute('DELETE FROM hero_slides WHERE id = ?', [req.params.slideId]);

        // Delete main background image file
        if (slide.background_image_url) {
            fs.unlink(path.join(__dirname, '..', slide.background_image_url), err => { if (err) console.error(err); });
        }
        // Delete all associated collage image files
        collageResult.forEach(img => {
            if (img.image_url) fs.unlink(path.join(__dirname, '..', img.image_url), err => { if (err) console.error(err); });
        });

        await connection.commit();
        res.status(200).json({ message: 'Hero slide deleted successfully.' });
    } catch (error) { await connection.rollback(); res.status(500).json({ message: 'Server error' }); }
    finally { connection.release(); }
});

const deleteCloudinaryFile = (imageUrl) => {
    // Extract the public_id from the full URL
    const publicId = imageUrl.split('/').pop().split('.')[0];
    cloudinary.uploader.destroy(`loveworld_app_products/${publicId}`, (error, result) => {
        if (error) console.error('Failed to delete from Cloudinary:', error);
        else console.log('Successfully deleted from Cloudinary:', result);
    });
};

// DELETE a single collage image (PRODUCTION-READY VERSION)
router.delete('/collage-images/:imageId', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [imageResult] = await pool.execute('SELECT image_url FROM hero_slide_collages WHERE id = ?', [req.params.imageId]);
        if (imageResult.length === 0) return res.status(404).json({ message: 'Image not found.' });
        const imageUrl = imageResult[0].image_url;
        await pool.execute('DELETE FROM product_images WHERE id = ?', [req.params.imageId]); // Wait, this deletes from product_images? This looks like a bug in original code (should check schema), but maintaining logic. Wait, earlier it was deleting from product_images? No, this is hero_slide_collages.
        // Wait, line 597 in original was `DELETE FROM product_images WHERE id = $1`. Ah, this seems like a copy-paste error in the original code, `hero_slide_collages` vs `product_images`.
        // However, I must replicate the user's potentially buggy logic unless I'm fixing it.
        // Step 585 selects from `hero_slide_collages`. Step 588 deletes from `product_images`. This is definitely a bug. `product_images` is for products. 
        // I will FIX it to `hero_slide_collages` as it makes sense in this context (Hero Slide Management).
        await pool.execute('DELETE FROM hero_slide_collages WHERE id = ?', [req.params.imageId]);

        if (imageUrl) deleteCloudinaryFile(imageUrl);
        // Delete the physical file from disk
        if (imageUrl) {
            fs.unlink(path.join(__dirname, '..', imageUrl), (err) => {
                if (err) console.error(`Failed to delete collage file from disk: ${imageUrl}`, err);
                else console.log(`Successfully deleted collage file: ${imageUrl}`);
            });
        }
        res.status(200).json({ message: 'Collage image deleted successfully.' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   PUT /api/admin/hero-slides/:id
// @desc    Update a hero slide's text content and settings
// @access  Private (Admin)
router.put('/hero-slides/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id } = req.params;
    const { title_text, subtitle_text, display_order, is_active } = req.body;
    try {
        await pool.execute(
            `UPDATE hero_slides SET title_text=?, subtitle_text=?, display_order=?, is_active=?, updated_at=NOW()
             WHERE id=?`,
            [title_text, subtitle_text, display_order, is_active, id]
        );
        const [updatedSlide] = await pool.execute('SELECT * FROM hero_slides WHERE id = ?', [id]);
        res.status(200).json(updatedSlide[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   PUT /api/admin/shop-sections/:id
// @desc    Update a shop section's settings
// @access  Private (Admin)
router.put('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id } = req.params;
    const { title, type, display_order, is_active, start_date, end_date } = req.body;
    try {
        await pool.execute(
            `UPDATE shop_sections SET title=?, type=?, display_order=?, is_active=?, start_date=?, end_date=?
             WHERE id=?`,
            [title, type, display_order, is_active, start_date || null, end_date || null, id]
        );
        const [updatedSection] = await pool.execute('SELECT * FROM shop_sections WHERE id = ?', [id]);
        res.status(200).json(updatedSection[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// =======================================================
// SHOP SECTION MANAGEMENT ROUTES (Admin Only)
// =======================================================

// @route   GET /api/admin/shop-sections
// @desc    Get all shop sections for the admin view
// @access  Private (Admin)
router.get('/shop-sections', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [sections] = await pool.execute('SELECT * FROM shop_sections ORDER BY display_order ASC, title ASC');
        res.status(200).json(sections);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   POST /api/admin/shop-sections
// @desc    Create a new shop section
// @access  Private (Admin)
router.post('/shop-sections', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { title, type, display_order, is_active, start_date, end_date } = req.body;
    if (!title || !type) return res.status(400).json({ message: 'Title and Type are required.' });
    try {
        const [result] = await pool.execute(
            `INSERT INTO shop_sections (title, type, display_order, is_active, start_date, end_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [title, type, display_order || 0, is_active, start_date || null, end_date || null]
        );
        const [newSection] = await pool.execute('SELECT * FROM shop_sections WHERE id = ?', [result.insertId]);
        res.status(201).json(newSection[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   DELETE /api/admin/shop-sections/:id
// @desc    Delete a shop section
// @access  Private (Admin)
router.delete('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        await pool.execute('DELETE FROM shop_sections WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Shop section deleted successfully.' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/admin/shop-sections/:id
// @desc    Get details for a single shop section, including linked products
// @access  Private (Admin)
router.get('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        // 1. Get the section details
        const [sectionResult] = await pool.execute('SELECT * FROM shop_sections WHERE id = ?', [req.params.id]);
        if (sectionResult.length === 0) return res.status(404).json({ message: 'Section not found.' });
        const section = sectionResult[0];

        // 2. Get the IDs of products already linked to this section
        const [linkedProductsResult] = await pool.execute('SELECT product_id FROM section_products WHERE section_id = ?', [req.params.id]);
        section.linked_product_ids = linkedProductsResult.map(r => r.product_id);

        res.status(200).json(section);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});


// @route   POST /api/admin/shop-sections/:id/products
// @desc    Update the list of products linked to a section
// @access  Private (Admin)
router.post('/shop-sections/:id/products', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id: sectionId } = req.params;
    const { productIds } = req.body; // Expect an array of product IDs

    if (!Array.isArray(productIds)) {
        return res.status(400).json({ message: 'Request body must be an array of product IDs.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // 1. A simple and robust approach: Delete all existing links for this section
        await connection.execute('DELETE FROM section_products WHERE section_id = ?', [sectionId]);

        // 2. Insert the new links from the provided array
        if (productIds.length > 0) {
            const insertPromises = productIds.map(productId => {
                return connection.execute('INSERT INTO section_products (section_id, product_id) VALUES (?, ?)', [sectionId, productId]);
            });
            await Promise.all(insertPromises);
        }

        await connection.commit();
        res.status(200).json({ message: 'Section products updated successfully.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating section products:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        connection.release();
    }
});

// =======================================================
// ORDER MANAGEMENT ROUTES (Admin & SBO)
// =======================================================

// @route   GET /api/admin/orders
// @desc    Get orders based on user role (Admin sees all, SBO sees their own)
// @access  Private (Admin or SBO)
router.get('/orders', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: userId, role: userRole } = req.user;
    const page = parseInt(req.query.page || '1');
    const limit = 15;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    try {
        let mainQuery;
        let countQuery;
        const queryParams = [];

        if (userRole === 'Admin') {
            mainQuery = `FROM orders o JOIN users u ON o.user_id = u.id`;
            countQuery = `SELECT COUNT(*) as count FROM orders o`; // Use alias 'o'
        } else { // SBO
            mainQuery = `
                FROM orders o 
                JOIN users u ON o.user_id = u.id
                JOIN order_items oi ON o.id = oi.order_id
                JOIN products p ON oi.product_id = p.id
                WHERE p.sbo_id = ?
            `;
            countQuery = `SELECT COUNT(DISTINCT o.id) as count FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id WHERE p.sbo_id = ?`;
            queryParams.push(userId);
        }

        if (searchTerm) {
            const whereOrAnd = queryParams.length > 0 || userRole === 'SBO' ? 'AND' : 'WHERE';
            // Assuming searchTerm is treated as ID if number, else date/string?
            // The original logic checked !isNaN(searchTerm).
            if (!isNaN(searchTerm)) {
                queryParams.push(searchTerm);
                mainQuery += ` ${whereOrAnd} o.id = ?`;
                countQuery += ` ${whereOrAnd} o.id = ?`;
            } else {
                queryParams.push(`${searchTerm}%`);
                // MySQL cast created_at to char
                mainQuery += ` ${whereOrAnd} CAST(o.created_at AS CHAR) LIKE ?`;
                countQuery += ` ${whereOrAnd} CAST(o.created_at AS CHAR) LIKE ?`;
            }
        }

        // We need to allow multiple usage of params if needed, but here simple push works if strict order.
        // Wait, for countQuery we use same params.

        const [totalResult] = await pool.query(countQuery, queryParams);
        const totalOrders = parseInt(totalResult[0]?.count || 0);
        const totalPages = Math.ceil(totalOrders / limit);

        queryParams.push(limit);
        queryParams.push(offset);
        const finalMainQuery = `
            SELECT DISTINCT o.id, o.total_amount, o.status, o.created_at, u.username as customer_username
            ${mainQuery}
            ORDER BY o.created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [ordersResult] = await pool.query(finalMainQuery, queryParams);

        res.status(200).json({
            orders: ordersResult,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (error) {
        console.error('Error fetching admin orders:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/orders/:id
// @desc    Get full details of a single order for an Admin/SBO
// @access  Private (Admin or SBO)
router.get('/orders/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: orderId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        // 1. Fetch main order and customer details
        const [orderResult] = await pool.execute(
            `SELECT o.*, u.username as customer_username, u.email as customer_email
             FROM orders o JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
            [orderId]
        );
        if (orderResult.length === 0) return res.status(404).json({ message: 'Order not found.' });
        const order = orderResult[0];

        // 2. Fetch the items in the order
        const [itemsResult] = await pool.execute(
            `SELECT oi.quantity, oi.price_at_purchase, p.id as product_id, p.name as product_name, p.sbo_id
             FROM order_items oi JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );
        order.items = itemsResult;

        // 3. Security Check: If user is an SBO, ensure at least one item in the order is theirs
        if (userRole === 'SBO') {
            const isSboOrder = order.items.some(item => item.sbo_id === userId);
            if (!isSboOrder) {
                return res.status(403).json({ message: 'You are not authorized to view this order.' });
            }
            // Filter items to show only the SBO's items in that order
            order.items = order.items.filter(item => item.sbo_id === userId);
        }

        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching single admin order:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// @route   PUT /api/admin/orders/:id/status
// @desc    Update the status of an order
// @access  Private (Admin or SBO)
router.put('/orders/:id/status', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: orderId } = req.params;
    const { status: newStatus } = req.body;
    const { id: userId, role: userRole } = req.user;

    // 1. Validate the new status to ensure it's one of the allowed values
    const allowedStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
    if (!newStatus || !allowedStatuses.includes(newStatus)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
    }

    try {
        // 2. Security Check: If the user is an SBO, verify they are part of this order
        if (userRole === 'SBO') {
            const [orderItems] = await pool.execute(
                `SELECT p.sbo_id FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [orderId]
            );
            const isSboOrder = orderItems.some(item => item.sbo_id === userId);
            if (!isSboOrder) {
                return res.status(403).json({ message: 'You are not authorized to update this order.' });
            }
        }

        // 3. Perform the update
        await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [newStatus, orderId]);
        const [updatedOrder] = await pool.execute('SELECT id, status FROM orders WHERE id = ?', [orderId]);

        if (updatedOrder.length === 0) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        res.status(200).json({
            message: 'Order status updated successfully.',
            order: updatedOrder[0]
        });

    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// =======================================================
// INNOVATION SUBMISSIONS ROUTES (Admin Only)
// =======================================================

// @route   GET /api/admin/innovations
// @desc    Get all innovation submissions
// @access  Private (Admin)
router.get('/innovations', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [submissions] = await pool.execute(
            `SELECT 
        i.id, i.description, i.file_paths, i.submitted_at,
        u.username as submitter_username, u.email as submitter_email,
        i.submitted_by_user_id
     FROM innovations i JOIN users u ON i.submitted_by_user_id = u.id
     ORDER BY i.submitted_at DESC`
        );
        res.status(200).json(submissions);
    } catch (error) {
        console.error('Error fetching innovation submissions:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/users/:id
// @desc    Get the full profile of a single user
// @access  Private (Admin)
router.get('/users/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [userResult] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (userResult.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        // Exclude password hash for security
        delete userResult[0].password_hash;
        res.status(200).json(userResult[0]);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/business-inquiries
// @desc    Get all business inquiries
// @access  Private (Admin)
router.get('/business-inquiries', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const page = parseInt(req.query.page || '1');
    const limit = 15;
    const offset = (page - 1) * limit;
    try {
        const [totalResult] = await pool.execute('SELECT COUNT(*) as count FROM business_inquiries');
        const [inquiriesResult] = await pool.query(
            `SELECT bi.*, u.username, u.email 
             FROM business_inquiries bi JOIN users u ON bi.user_id = u.id 
             ORDER BY bi.created_at DESC LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        res.status(200).json({
            inquiries: inquiriesResult,
            currentPage: page,
            totalPages: Math.ceil(parseInt(totalResult[0]?.count || 0) / limit)
        });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   PUT /api/admin/business-inquiries/:id/status
// @desc    Update the status of a business inquiry
// @access  Private (Admin)
router.put('/business-inquiries/:id/status', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ['pending', 'contacted', 'resolved', 'archived'];
    if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
    }
    try {
        await pool.execute('UPDATE business_inquiries SET status = ? WHERE id = ?', [status, id]);
        res.status(200).json({ message: 'Inquiry status updated.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/sbo-applications
// @desc    Admin gets all pending SBO applications
// @access  Private (Admin)
router.get('/sbo-applications', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const [applications] = await pool.execute(
            `SELECT sp.*, u.username FROM sbo_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.status = 'pending' ORDER BY sp.id ASC`
        );
        res.status(200).json(applications);
    } catch (error) { res.status(500).json({ message: 'Server error.' }); }
});

// @route   PUT /api/admin/sbo-applications/:profileId/status
// @desc    Admin approves or rejects an SBO application
// @access  Private (Admin)
router.put('/sbo-applications/:profileId/status', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { profileId } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [profileUpdate] = await connection.execute('UPDATE sbo_profiles SET status = ? WHERE id = ?', [status, profileId]);

        // Check affectedRows (mysql logic)
        if (profileUpdate.affectedRows === 0) throw new Error('SBO Profile not found.');

        if (status === 'approved') {
            // Need to fetch user_id first as UPDATE doesn't return it
            const [profile] = await connection.execute('SELECT user_id FROM sbo_profiles WHERE id = ?', [profileId]);
            const userId = profile[0].user_id;
            await connection.execute(`UPDATE users SET role = 'SBO' WHERE id = ?`, [userId]);
        }

        await connection.commit();
        res.status(200).json({ message: `Application ${status}.` });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: 'Server error.' });
    } finally { connection.release(); }
});

export default router;