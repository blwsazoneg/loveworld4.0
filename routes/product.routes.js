// routes/product.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

const router = express.Router();

// === PRODUCT CRUD ===
// CREATE a new product
router.post('/', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    // ... Logic to insert a new product into the 'products' table ...
    res.status(201).json({ message: 'Product created successfully.' });
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
// UPDATE a product
router.put('/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    // ... Logic to update a product, checking for ownership ...
    res.status(200).json({ message: 'Product updated successfully.' });
});

// DELETE a product
router.delete('/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    // ... Logic to delete a product, checking for ownership ...
    res.status(200).json({ message: 'Product deleted.' });
});


// === SECTOR/BRAND/SECTION MANAGEMENT (Admin Only) ===

// GET all sectors
router.get('/sectors', async (req, res) => {
    const sectors = await pool.query('SELECT * FROM sectors ORDER BY name');
    res.status(200).json(sectors.rows);
});

// CREATE a new sector
router.post('/sectors', authenticateToken, checkRole(['Admin']), async (req, res) => {
    // ... Logic to create a new sector ...
    res.status(201).json({ message: 'Sector created.' });
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



// @route   GET /api/products/:id
// @desc    Get a single product by its ID for public view
// @access  Public
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Fetch main product and JOIN with SBO profile
        const productResult = await pool.query(
            `SELECT 
                p.*, 
                b.name as brand_name, 
                s.name as sector_name,
                sbop.company_name as sbo_company_name,
                sbop.contact_phone as sbo_contact_phone,
                sbop.contact_email as sbo_contact_email
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

// (You would add similar CRUD endpoints for Brands, Hero Slides, and Shop Sections)


export default router;