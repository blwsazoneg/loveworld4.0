// routes/admin.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

// --- Multer Configuration for Product Images ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/products'); // Store product images in a dedicated subfolder
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---------------------------------------------

// @route   POST /api/admin/products
// @desc    Create a new product with images
// @access  Private (Admin or SBO)
router.post('/products', authenticateToken, checkRole(['Admin', 'SBO']), upload.array('images'), async (req, res) => {
    // THE FIX: Add 'sbo_profile_id' to the destructuring assignment
    const { name, description, price, stock_quantity, sector_id, brand_id, sbo_profile_id } = req.body;
    const sboUserId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let finalSboProfileId = sbo_profile_id;
        if (req.user.role === 'SBO') {
            const sboProfileResult = await client.query('SELECT id FROM sbo_profiles WHERE user_id = $1', [sboUserId]);
            if (sboProfileResult.rows.length === 0) throw new Error('SBO profile not found for this user.');
            finalSboProfileId = sboProfileResult.rows[0].id;
        }

        const productQuery = `
                INSERT INTO products (name, description, price, stock_quantity, sector_id, brand_id, sbo_id, sbo_profile_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id;`;
        const productValues = [name, description, price, stock_quantity, sector_id, brand_id, sboUserId, finalSboProfileId || null];
        const newProduct = await client.query(productQuery, productValues);
        const newProductId = newProduct.rows[0].id;

        if (req.files && req.files.length > 0) {
            const imageInsertPromises = req.files.map((file, index) => {
                const imageUrl = `/uploads/products/${file.filename}`;
                return client.query('INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)', [newProductId, imageUrl, index]);
            });
            await Promise.all(imageInsertPromises);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Product created successfully!', productId: newProductId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating product:', error);
        res.status(500).json({ message: error.message || 'Failed to create product. Transaction rolled back.' });
    } finally {
        client.release();
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
        const productsResult = await pool.query(
            `SELECT p.id, p.name, p.price, p.stock_quantity, p.is_active, s.name as sector_name, b.name as brand_name
             FROM products p
             LEFT JOIN sectors s ON p.sector_id = s.id
             LEFT JOIN brands b ON p.brand_id = b.id
             ORDER BY p.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        // Query to get the total count for pagination controls
        const totalResult = await pool.query('SELECT COUNT(*) FROM products');
        const totalProducts = parseInt(totalResult.rows[0].count);
        const totalPages = Math.ceil(totalProducts / limit);

        res.status(200).json({
            products: productsResult.rows,
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
        const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        const product = productResult.rows[0];
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const productResult = await client.query('SELECT sbo_id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) throw new Error('Product not found.');
        if (userRole !== 'Admin' && productResult.rows[0].sbo_id !== userId) throw new Error('Authorization failed.');

        // 1. Update the product's text/numeric data
        await client.query(
            `UPDATE products SET 
                    name = $1, description = $2, price = $3, stock_quantity = $4, sector_id = $5, brand_id = $6, 
                    is_active = $7, allow_backorder = $8, sale_price = $9, sale_start_date = $10, sale_end_date = $11,
                    sbo_profile_id = $12, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $13`,
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
                return client.query('INSERT INTO product_images (product_id, image_url) VALUES ($1, $2)', [productId, imageUrl]);
            });
            await Promise.all(imageInsertPromises);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Product updated successfully!' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating product:', error);
        res.status(500).json({ message: error.message || 'Server error while updating product.' });
    } finally {
        client.release();
    }
}
);

// @route   GET /api/admin/products/:id/images
// @desc    Get all images for a specific product
// @access  Private (Admin or SBO)
router.get('/products/:id/images', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    try {
        const images = await pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC', [productId]);
        res.status(200).json(images.rows);
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const productResult = await client.query('SELECT sbo_id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) throw new Error('Product not found.');
        if (userRole !== 'Admin' && productResult.rows[0].sbo_id !== userId) throw new Error('Authorization failed.');

        const imageInsertPromises = req.files.map((file, index) => {
            const imageUrl = `/${file.path.replace(/\\/g, "/")}`;
            return client.query('INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)', [productId, imageUrl, index]);
        });
        await Promise.all(imageInsertPromises);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Images uploaded successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error uploading product images:', error);
        res.status(500).json({ message: error.message || 'Server error.' });
    } finally {
        client.release();
    }
});

// @route   DELETE /api/admin/products/:id
// @desc    Delete a product and its images
// @access  Private (Admin or SBO who owns the product)
router.delete('/products/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get product owner and image paths for deletion
        const productResult = await client.query(
            `SELECT p.sbo_id, array_agg(pi.image_url) as image_urls
             FROM products p
             LEFT JOIN product_images pi ON p.id = pi.product_id
             WHERE p.id = $1
             GROUP BY p.sbo_id`,
            [productId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        const productData = productResult.rows[0];

        // 2. Security Check: Ensure SBO can only delete their own product
        if (userRole !== 'Admin' && productData.sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this product.' });
        }

        // 3. Delete the product from the database.
        // ON DELETE CASCADE will handle deleting from: product_images, section_products, cart_items, order_items.
        await client.query('DELETE FROM products WHERE id = $1', [productId]);

        // 4. Delete the physical image files from the /uploads folder
        if (productData.image_urls && productData.image_urls[0] !== null) {
            productData.image_urls.forEach(imageUrl => {
                // Construct file path from project root
                const filePath = path.join(__dirname, '..', imageUrl);
                fs.unlink(filePath, (err) => {
                    if (err) console.error(`Failed to delete file from disk: ${filePath}`, err);
                    else console.log(`Successfully deleted file: ${filePath}`);
                });
            });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Product deleted successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// @route   DELETE /api/admin/images/:imageId
// @desc    Delete a single product image
// @access  Private (Admin or SBO who owns the product)
router.delete('/images/:imageId', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { imageId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const imageResult = await pool.query(
            `SELECT pi.image_url, p.sbo_id FROM product_images pi
             JOIN products p ON pi.product_id = p.id
             WHERE pi.id = $1`, [imageId]
        );
        if (imageResult.rows.length === 0) return res.status(404).json({ message: 'Image not found.' });

        const imageData = imageResult.rows[0];
        if (userRole !== 'Admin' && imageData.sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this image.' });
        }

        // --- THIS IS THE PRODUCTION-READY FIX ---
        // 1. Delete the record from the database
        await pool.query('DELETE FROM product_images WHERE id = $1', [imageId]);

        // 2. Delete the actual file from the server's disk
        // Construct the full file path from the project root
        const filePath = path.join(__dirname, '..', imageData.image_url);
        fs.unlink(filePath, (err) => {
            if (err) {
                // Log the error, but don't block the success response.
                // The DB record is the source of truth.
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
        const sboProfiles = await pool.query(
            'SELECT id, company_name FROM sbo_profiles ORDER BY company_name ASC'
        );
        res.status(200).json(sboProfiles.rows);
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
            const existing = await pool.query('SELECT id FROM sectors WHERE name ILIKE $1', [name]);
            if (existing.rows.length > 0) return res.status(409).json({ message: 'A sector with this name already exists.' });

            // Get the public path of the uploaded files, if they exist
            // req.files is now an object, e.g., { image_url: [file], hero_image_url: [file] }
            const imageUrl = req.files['image_url'] ? `/uploads/products/${req.files['image_url'][0].filename}` : null;
            const heroImageUrl = req.files['hero_image_url'] ? `/uploads/products/${req.files['hero_image_url'][0].filename}` : null;

            const newSector = await pool.query(
                `INSERT INTO sectors (name, image_url, hero_image_url, is_featured, display_order)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [
                    name,
                    imageUrl,
                    heroImageUrl,
                    is_featured === 'true', // FormData sends booleans as strings 
                    display_order || 0
                ]
            );

            res.status(201).json(newSector.rows[0]);
        } catch (error) {
            console.error('Error creating sector:', error);
            res.status(500).json({ message: 'Server error while creating sector.' });
        }
    }
);

// @route   DELETE /api/admin/sectors/:id
// @desc    Delete a sector
// @access  Private (Admin)
router.delete('/sectors/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        // Note: The ON DELETE SET NULL on products.sector_id will handle un-linking products.
        await pool.query('DELETE FROM sectors WHERE id = $1', [req.params.id]);
        res.status(200).json({ message: 'Sector deleted successfully.' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
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
        const existing = await pool.query('SELECT id FROM brands WHERE name ILIKE $1', [name]);
        if (existing.rows.length > 0) return res.status(409).json({ message: 'A brand with this name already exists.' });

        const newBrand = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING *', [name]);
        res.status(201).json(newBrand.rows[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   DELETE /api/admin/brands/:id
// @desc    Delete a brand
// @access  Private (Admin)
router.delete('/brands/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        await pool.query('DELETE FROM brands WHERE id = $1', [req.params.id]);
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
        const slidesResult = await pool.query('SELECT * FROM hero_slides ORDER BY display_order ASC');
        const slides = slidesResult.rows;
        // For each slide, fetch its collage images
        for (const slide of slides) {
            const collageResult = await pool.query('SELECT * FROM hero_slide_collages WHERE slide_id = $1', [slide.id]);
            slide.collage_images = collageResult.rows;
        }
        res.status(200).json(slides);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// POST (Create) a new hero slide
router.post('/hero-slides', authenticateToken, checkRole(['Admin']), upload.single('background_image_url'), async (req, res) => {
    const { title_text, subtitle_text, display_order, is_active } = req.body;
    if (!req.file) return res.status(400).json({ message: 'A background image is required.' });

    try {
        const backgroundImageUrl = `/uploads/products/${req.file.filename}`;
        const newSlide = await pool.query(
            `INSERT INTO hero_slides (title_text, subtitle_text, background_image_url, is_active, display_order) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [title_text, subtitle_text, backgroundImageUrl, is_active === 'true', display_order || 0]
        );
        // Return the new slide with an empty collage_images array for the frontend
        const slideData = newSlide.rows[0];
        slideData.collage_images = [];
        res.status(201).json(slideData);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
}
);

// POST (Add) a collage image to a slide
router.post('/hero-slides/:slideId/collage', authenticateToken, checkRole(['Admin']), upload.single('image_url'), async (req, res) => {
    const { slideId } = req.params;
    const { top_position, left_position, width, height, z_index } = req.body;
    if (!req.file) return res.status(400).json({ message: 'An image file is required.' });

    try {
        const imageUrl = `/uploads/products/${req.file.filename}`;
        const newCollageImage = await pool.query(
            `INSERT INTO hero_slide_collages (slide_id, image_url, top_position, left_position, width, height, z_index) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [slideId, imageUrl, top_position || '50%', left_position || '50%', width || '150px', height || '150px', z_index || 10]
        );
        res.status(201).json(newCollageImage.rows[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
}
);

// DELETE a hero slide
router.delete('/hero-slides/:slideId', authenticateToken, checkRole(['Admin']), async (req, res) => {
    // This is complex because we need to delete multiple files.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const slideResult = await client.query('SELECT * FROM hero_slides WHERE id = $1', [req.params.slideId]);
        if (slideResult.rows.length === 0) return res.status(404).json({ message: 'Slide not found.' });
        const slide = slideResult.rows[0];

        const collageResult = await client.query('SELECT image_url FROM hero_slide_collages WHERE slide_id = $1', [req.params.slideId]);

        await client.query('DELETE FROM hero_slides WHERE id = $1', [req.params.slideId]);

        // Delete main background image file
        if (slide.background_image_url) {
            fs.unlink(path.join(__dirname, '..', slide.background_image_url), err => { if (err) console.error(err); });
        }
        // Delete all associated collage image files
        collageResult.rows.forEach(img => {
            if (img.image_url) fs.unlink(path.join(__dirname, '..', img.image_url), err => { if (err) console.error(err); });
        });

        await client.query('COMMIT');
        res.status(200).json({ message: 'Hero slide deleted successfully.' });
    } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ message: 'Server error' }); }
    finally { client.release(); }
});

// DELETE a single collage image (PRODUCTION-READY VERSION)
router.delete('/collage-images/:imageId', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        const imageResult = await pool.query('SELECT image_url FROM hero_slide_collages WHERE id = $1', [req.params.imageId]);
        if (imageResult.rows.length === 0) return res.status(404).json({ message: 'Image not found.' });
        const imageUrl = imageResult.rows[0].image_url;

        await pool.query('DELETE FROM hero_slide_collages WHERE id = $1', [req.params.imageId]);

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
        const updatedSlide = await pool.query(
            `UPDATE hero_slides SET title_text=$1, subtitle_text=$2, display_order=$3, is_active=$4, updated_at=NOW()
             WHERE id=$5 RETURNING *`,
            [title_text, subtitle_text, display_order, is_active, id]
        );
        res.status(200).json(updatedSlide.rows[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   PUT /api/admin/shop-sections/:id
// @desc    Update a shop section's settings
// @access  Private (Admin)
router.put('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id } = req.params;
    const { title, type, display_order, is_active, start_date, end_date } = req.body;
    try {
        const updatedSection = await pool.query(
            `UPDATE shop_sections SET title=$1, type=$2, display_order=$3, is_active=$4, start_date=$5, end_date=$6
             WHERE id=$7 RETURNING *`,
            [title, type, display_order, is_active, start_date || null, end_date || null, id]
        );
        res.status(200).json(updatedSection.rows[0]);
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
        const sections = await pool.query('SELECT * FROM shop_sections ORDER BY display_order ASC, title ASC');
        res.status(200).json(sections.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   POST /api/admin/shop-sections
// @desc    Create a new shop section
// @access  Private (Admin)
router.post('/shop-sections', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { title, type, display_order, is_active, start_date, end_date } = req.body;
    if (!title || !type) return res.status(400).json({ message: 'Title and Type are required.' });
    try {
        const newSection = await pool.query(
            `INSERT INTO shop_sections (title, type, display_order, is_active, start_date, end_date)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [title, type, display_order || 0, is_active, start_date || null, end_date || null]
        );
        res.status(201).json(newSection.rows[0]);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   DELETE /api/admin/shop-sections/:id
// @desc    Delete a shop section
// @access  Private (Admin)
router.delete('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        await pool.query('DELETE FROM shop_sections WHERE id = $1', [req.params.id]);
        res.status(200).json({ message: 'Shop section deleted successfully.' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/admin/shop-sections/:id
// @desc    Get details for a single shop section, including linked products
// @access  Private (Admin)
router.get('/shop-sections/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        // 1. Get the section details
        const sectionResult = await pool.query('SELECT * FROM shop_sections WHERE id = $1', [req.params.id]);
        if (sectionResult.rows.length === 0) return res.status(404).json({ message: 'Section not found.' });
        const section = sectionResult.rows[0];

        // 2. Get the IDs of products already linked to this section
        const linkedProductsResult = await pool.query('SELECT product_id FROM section_products WHERE section_id = $1', [req.params.id]);
        section.linked_product_ids = linkedProductsResult.rows.map(r => r.product_id);

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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 1. A simple and robust approach: Delete all existing links for this section
        await client.query('DELETE FROM section_products WHERE section_id = $1', [sectionId]);

        // 2. Insert the new links from the provided array
        if (productIds.length > 0) {
            const insertPromises = productIds.map(productId => {
                return client.query('INSERT INTO section_products (section_id, product_id) VALUES ($1, $2)', [sectionId, productId]);
            });
            await Promise.all(insertPromises);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Section products updated successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating section products:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
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
            countQuery = `SELECT COUNT(*) FROM orders o`; // Use alias 'o'
        } else { // SBO
            mainQuery = `
                FROM orders o 
                JOIN users u ON o.user_id = u.id
                JOIN order_items oi ON o.id = oi.order_id
                JOIN products p ON oi.product_id = p.id
                WHERE p.sbo_id = $1
            `;
            countQuery = `SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id WHERE p.sbo_id = $1`;
            queryParams.push(userId);
        }

        if (searchTerm) {
            const whereOrAnd = queryParams.length > 0 || userRole === 'SBO' ? 'AND' : 'WHERE';
            if (!isNaN(searchTerm)) {
                queryParams.push(searchTerm);
                // THE FIX: Specify o.id
                mainQuery += ` ${whereOrAnd} o.id = $${queryParams.length}`;
                countQuery += ` ${whereOrAnd} o.id = $${queryParams.length}`; // Also fix it here
            } else {
                queryParams.push(`${searchTerm}%`);
                mainQuery += ` ${whereOrAnd} CAST(o.created_at AS TEXT) ILIKE $${queryParams.length}`;
                countQuery += ` ${whereOrAnd} CAST(o.created_at AS TEXT) ILIKE $${queryParams.length}`;
            }
        }

        const totalResult = await pool.query(countQuery, queryParams);
        const totalOrders = parseInt(totalResult.rows[0].count);
        const totalPages = Math.ceil(totalOrders / limit);

        queryParams.push(limit);
        queryParams.push(offset);
        const finalMainQuery = `
            SELECT DISTINCT o.id, o.total_amount, o.status, o.created_at, u.username as customer_username
            ${mainQuery}
            ORDER BY o.created_at DESC 
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `;
        const ordersResult = await pool.query(finalMainQuery, queryParams);

        res.status(200).json({
            orders: ordersResult.rows,
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
        const orderResult = await pool.query(
            `SELECT o.*, u.username as customer_username, u.email as customer_email
             FROM orders o JOIN users u ON o.user_id = u.id
             WHERE o.id = $1`,
            [orderId]
        );
        if (orderResult.rows.length === 0) return res.status(404).json({ message: 'Order not found.' });
        const order = orderResult.rows[0];

        // 2. Fetch the items in the order
        const itemsResult = await pool.query(
            `SELECT oi.quantity, oi.price_at_purchase, p.id as product_id, p.name as product_name, p.sbo_id
             FROM order_items oi JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [orderId]
        );
        order.items = itemsResult.rows;

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
            const orderItems = await pool.query(
                `SELECT p.sbo_id FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = $1`,
                [orderId]
            );
            const isSboOrder = orderItems.rows.some(item => item.sbo_id === userId);
            if (!isSboOrder) {
                return res.status(403).json({ message: 'You are not authorized to update this order.' });
            }
        }

        // 3. Perform the update
        const updatedOrder = await pool.query(
            'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status',
            [newStatus, orderId]
        );

        if (updatedOrder.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        res.status(200).json({
            message: 'Order status updated successfully.',
            order: updatedOrder.rows[0]
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
        const submissions = await pool.query(
            `SELECT 
        i.id, i.description, i.file_paths, i.submitted_at,
        u.username as submitter_username, u.email as submitter_email,
        i.submitted_by_user_id
     FROM innovations i JOIN users u ON i.submitted_by_user_id = u.id
     ORDER BY i.submitted_at DESC`
        );
        res.status(200).json(submissions.rows);
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
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        // Exclude password hash for security
        delete userResult.rows[0].password_hash;
        res.status(200).json(userResult.rows[0]);
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
        const totalResult = await pool.query('SELECT COUNT(*) FROM business_inquiries');
        const inquiriesResult = await pool.query(
            `SELECT bi.*, u.username, u.email 
             FROM business_inquiries bi JOIN users u ON bi.user_id = u.id 
             ORDER BY bi.created_at DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        res.status(200).json({
            inquiries: inquiriesResult.rows,
            currentPage: page,
            totalPages: Math.ceil(parseInt(totalResult.rows[0].count) / limit)
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
        await pool.query('UPDATE business_inquiries SET status = $1 WHERE id = $2', [status, id]);
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
        const applications = await pool.query(
            `SELECT sp.*, u.username FROM sbo_profiles sp JOIN users u ON sp.user_id = u.id WHERE sp.status = 'pending' ORDER BY sp.id ASC`
        );
        res.status(200).json(applications.rows);
    } catch (error) { res.status(500).json({ message: 'Server error.' }); }
});

// @route   PUT /api/admin/sbo-applications/:profileId/status
// @desc    Admin approves or rejects an SBO application
// @access  Private (Admin)
router.put('/sbo-applications/:profileId/status', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { profileId } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const profileUpdate = await client.query('UPDATE sbo_profiles SET status = $1 WHERE id = $2 RETURNING user_id', [status, profileId]);
        if (profileUpdate.rows.length === 0) throw new Error('SBO Profile not found.');

        if (status === 'approved') {
            const userId = profileUpdate.rows[0].user_id;
            await client.query(`UPDATE users SET role = 'SBO' WHERE id = $1`, [userId]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Application ${status}.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: 'Server error.' });
    } finally { client.release(); }
});

export default router;