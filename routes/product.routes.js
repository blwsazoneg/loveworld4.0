// routes/product.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

const router = express.Router();


// GET all sectors
router.get('/sectors', async (req, res) => {
    const sectors = await pool.query('SELECT * FROM sectors ORDER BY name');
    res.status(200).json(sectors.rows);
});

// Get all brands
router.get('/brands', async (req, res) => {
    try {
        const brands = await pool.query('SELECT * FROM brands ORDER BY name');
        res.status(200).json(brands.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Get products by sector name
router.get('/sector/:sectorName', async (req, res) => {
    const { sectorName } = req.params;
    try {
        // Step 1: Find the sector itself to get its details (like the image_url)
        const sectorResult = await pool.query(
            'SELECT * FROM sectors WHERE name = $1',
            [sectorName]
        );

        if (sectorResult.rows.length === 0) {
            return res.status(404).json({ message: 'Sector not found.' });
        }
        const sector = sectorResult.rows[0];

        // Step 2: Find all products belonging to this sector
        const productsResult = await pool.query(
            `SELECT p.id, p.name, p.price, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = $1 AND p.is_active = true`,
            [sector.id]
        );

        // Step 3: Combine the sector info and the products into a single response
        res.status(200).json({
            sector: sector,
            products: productsResult.rows
        });

    } catch (error) {
        console.error('Error fetching products by sector:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/products/sector/:sectorId/bestsellers
// @desc    Get the top 10 best-selling products in a specific sector from the last 30 days
// @access  Public
router.get('/sector/:sectorId/bestsellers', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const bestsellersResult = await pool.query(
            `SELECT
                p.id, p.name, p.price,
                SUM(oi.quantity) as total_sold,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE p.sector_id = $1 AND o.created_at >= NOW() - interval '30 days' AND p.is_active = true
             GROUP BY p.id
             ORDER BY total_sold DESC
             LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(bestsellersResult.rows);
    } catch (error) {
        console.error('Error fetching sector bestsellers:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/products/sector/:sectorId/new-arrivals
// @desc    Get the 10 newest products in a specific sector
// @access  Public
router.get('/sector/:sectorId/new-arrivals', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const newArrivalsResult = await pool.query(
            `SELECT
                p.id, p.name, p.price,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = $1 AND p.is_active = true
             ORDER BY p.created_at DESC
             LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(newArrivalsResult.rows);
    } catch (error) {
        console.error('Error fetching sector new arrivals:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/products/sector/:sectorId/family-feasts
// @desc    Get products tagged as 'family feast' in a specific sector
// @access  Public
router.get('/sector/:sectorId/family-feasts', async (req, res) => {
    const { sectorId } = req.params;
    try {
        // In production, you might search for a specific tag. For now, we'll search by name.
        const results = await pool.query(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = $1 AND p.is_active = true AND (p.name ILIKE '%feast%' OR p.name ILIKE '%family%')
             ORDER BY p.created_at DESC LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(results.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/sector/:sectorId/fruits-vegetables
// @desc    Get products tagged as 'fruit' or 'vegetable' in a specific sector
// @access  Public
router.get('/sector/:sectorId/fruits-vegetables', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const results = await pool.query(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = $1 AND p.is_active = true AND (p.name ILIKE '%fruit%' OR p.name ILIKE '%vegetable%')
             ORDER BY p.created_at DESC LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(results.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   POST /api/products/sectors
// @desc    Create a new sector
// @access  Private (Admin only)
router.post('/sectors', authenticateToken, checkRole(['Admin']), async (req, res) => {
    // We expect a 'name' and optionally an 'image_url' from the admin form
    const { name, image_url, hero_image_url, is_featured, display_order } = req.body;

    // 1. Validation
    if (!name) {
        return res.status(400).json({ message: 'Sector name is required.' });
    }

    try {
        // 2. Check for Duplicates (case-insensitive)
        const existingSector = await pool.query(
            'SELECT id FROM sectors WHERE name ILIKE $1',
            [name]
        );

        if (existingSector.rows.length > 0) {
            return res.status(409).json({ message: 'A sector with this name already exists.' });
        }

        // 3. Insert the new sector into the database
        const newSector = await pool.query(
            `INSERT INTO sectors (name, image_url, hero_image_url, is_featured, display_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                name,
                image_url || null,
                hero_image_url || null,
                is_featured || false,
                display_order || 0
            ]
        );

        // 4. Send a success response with the newly created sector object
        res.status(201).json({
            message: 'Sector created successfully.',
            sector: newSector.rows[0]
        });

    } catch (error) {
        console.error('Error creating sector:', error);
        res.status(500).json({ message: 'Server error while creating sector.' });
    }
});


// === PRODUCT CRUD ===
// CREATE a new product
router.post('/', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    // This assumes multer is configured on this route in server.js
    // For simplicity, let's assume no file uploads for this generic endpoint for now.
    // The one in admin.routes.js is superior.
    res.status(501).json({
        message: 'Product creation should be done via /api/admin/products to handle image uploads.'
    });
});


// READ all products (for the public shop page)
router.get('/', async (req, res) => {
    // We get the search term from a query parameter 'q'
    const searchTerm = req.query.q || '';

    if (!searchTerm) {
        // If there's no search term, return an empty array.
        return res.status(200).json([]);
    }

    try {
        const searchResult = await pool.query(
            `SELECT 
                p.id, p.name, p.price,
                b.name as brand_name, 
                s.name as sector_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM products p
             LEFT JOIN brands b ON p.brand_id = b.id
             LEFT JOIN sectors s ON p.sector_id = s.id
             WHERE 
                p.is_active = true AND (
                    p.name ILIKE $1 OR
                    p.description ILIKE $1 OR
                    b.name ILIKE $1 OR
                    s.name ILIKE $1
                )
             LIMIT 50`, // Limit results to prevent overwhelming the server
            [`%${searchTerm}%`]
        );

        res.status(200).json(searchResult.rows);
    } catch (error) {
        console.error('Error during product search:', error);
        res.status(500).json({ message: 'Server error during search.' });
    }
});

// @route   PUT /api/products/:id (Admin Update)
// @desc    Update a product
// @access  Private (Admin or SBO)
router.put('/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;
    const {
        name, description, price, stock_quantity, sector_id, brand_id, is_active,
        allow_backorder, sale_price, sale_start_date, sale_end_date
    } = req.body;

    if (!name || !description || !price) {
        return res.status(400).json({ message: 'Name, description, and price are required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const productResult = await client.query('SELECT sbo_id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        if (userRole !== 'Admin' && productResult.rows[0].sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to update this product.' });
        }

        const updatedProduct = await client.query(
            `UPDATE products SET 
                name = $1, description = $2, price = $3, stock_quantity = $4, sector_id = $5, brand_id = $6, is_active = $7,
                allow_backorder = $8, sale_price = $9, sale_start_date = $10, sale_end_date = $11, updated_at = CURRENT_TIMESTAMP
             WHERE id = $12 RETURNING *`,
            [
                name, description, price, stock_quantity, sector_id, brand_id, is_active,
                allow_backorder, sale_price, sale_start_date, sale_end_date,
                productId
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Product updated successfully.', product: updatedProduct.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating product:', error);
        res.status(500).json({ message: 'Server error while updating product.' });
    } finally {
        client.release();
    }
});


// @route   DELETE /api/products/:id (Admin Delete)
// @desc    Delete a product
// @access  Private (Admin or SBO)
router.delete('/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const productResult = await pool.query('SELECT sbo_id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        if (userRole !== 'Admin' && productResult.rows[0].sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this product.' });
        }

        await pool.query('DELETE FROM products WHERE id = $1', [productId]);
        res.status(200).json({ message: 'Product deleted successfully.' });

    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// === SECTOR/BRAND/SECTION MANAGEMENT (Admin Only) ===


// CREATE a new sector
// router.post('/sectors', authenticateToken, checkRole(['Admin']), async (req, res) => {
//     res.status(201).json({ message: 'Sector created.' });
// });


// @route   GET /api/products/:id
// @desc    Get a single product by its ID for public view
// @access  Public
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const productResult = await pool.query(
            `SELECT 
                p.*, 
                b.name as brand_name, s.name as sector_name,
                sbop.company_name as sbo_company_name, sbop.contact_phone as sbo_contact_phone,
                sbop.contact_email as sbo_contact_email,
                -- THE FIX: Use a CASE statement to determine the active price
                CASE
                    WHEN p.sale_price IS NOT NULL AND (p.sale_start_date IS NULL OR p.sale_start_date <= NOW()) AND (p.sale_end_date IS NULL OR p.sale_end_date >= NOW())
                    THEN p.sale_price
                    ELSE p.price
                END as active_price,
                CASE
                    WHEN p.sale_price IS NOT NULL AND (p.sale_start_date IS NULL OR p.sale_start_date <= NOW()) AND (p.sale_end_date IS NULL OR p.sale_end_date >= NOW())
                    THEN p.price
                    ELSE NULL
                END as original_price -- The old price, only show if on sale
             FROM products p
             LEFT JOIN brands b ON p.brand_id = b.id
             LEFT JOIN sectors s ON p.sector_id = s.id
             LEFT JOIN sbo_profiles sbop ON p.sbo_profile_id = sbop.id
             WHERE p.id = $1 AND p.is_active = true`,
            [id]
        );

        if (productResult.rows.length === 0) return res.status(404).json({ message: 'Product not found.' });
        const product = productResult.rows[0];

        // 2. Fetch all images for this product
        const imagesResult = await pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC', [id]);
        product.images = imagesResult.rows;

        // 3. Fetch RELATED products (from the same sector, excluding the current product)
        if (product.sector_id) {
            const relatedResult = await pool.query(
                `SELECT p.id, p.name, p.price, 
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
                 FROM products p
                 WHERE p.sector_id = $1 AND p.id != $2 AND p.is_active = true
                 LIMIT 4`,
                [product.sector_id, id]
            );
            product.related_products = relatedResult.rows;
        } else {
            product.related_products = [];
        }

        res.status(200).json(product);
    } catch (error) {
        console.error('Error fetching single product:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// routes/product.routes.js

// --- ADD THESE NEW ROUTES ---

// @route   GET /api/products/list/new-releases
// @desc    Get the most recently added products
// @access  Public
router.get('/list/new-releases', async (req, res) => {
    try {
        const products = await pool.query(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url FROM products p WHERE p.is_active = true ORDER BY p.created_at DESC LIMIT 20`
        );
        res.status(200).json(products.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/list/best-sellers
// @desc    Get the all-time best-selling products
// @access  Public
router.get('/list/best-sellers', async (req, res) => {
    try {
        const products = await pool.query(
            `SELECT p.id, p.name, p.price, SUM(oi.quantity) as total_sold, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p JOIN order_items oi ON p.id = oi.product_id
             WHERE p.is_active = true GROUP BY p.id ORDER BY total_sold DESC LIMIT 20`
        );
        res.status(200).json(products.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/list/specials
// @desc    Get all products currently on sale
// @access  Public
router.get('/list/specials', async (req, res) => {
    try {
        const products = await pool.query(
            `SELECT p.id, p.name, p.price, p.sale_price as active_price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.is_active = true AND p.sale_price IS NOT NULL
             AND (p.sale_start_date IS NULL OR p.sale_start_date <= NOW())
             AND (p.sale_end_date IS NULL OR p.sale_end_date >= NOW())
             ORDER BY p.created_at DESC LIMIT 20`
        );
        res.status(200).json(products.rows);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// (You would add similar CRUD endpoints for Brands, Hero Slides, and Shop Sections)


export default router;