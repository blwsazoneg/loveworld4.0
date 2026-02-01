// routes/product.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

const router = express.Router();


// GET all sectors
router.get('/sectors', async (req, res) => {
    try {
        const [sectors] = await pool.execute('SELECT * FROM sectors ORDER BY name');
        res.status(200).json(sectors);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Get all brands
router.get('/brands', async (req, res) => {
    try {
        const [brands] = await pool.execute('SELECT * FROM brands ORDER BY name');
        res.status(200).json(brands);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Get products by sector name
router.get('/sector/:sectorName', async (req, res) => {
    const { sectorName } = req.params;
    try {
        // Step 1: Find the sector itself to get its details (like the image_url)
        const [sectorResult] = await pool.execute(
            'SELECT * FROM sectors WHERE name = ?',
            [sectorName]
        );

        if (sectorResult.length === 0) {
            return res.status(404).json({ message: 'Sector not found.' });
        }
        const sector = sectorResult[0];

        // Step 2: Find all products belonging to this sector
        const [productsResult] = await pool.execute(
            `SELECT p.id, p.name, p.price, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = ? AND p.is_active = true`,
            [sector.id]
        );

        // Step 3: Combine the sector info and the products into a single response
        res.status(200).json({
            sector: sector,
            products: productsResult
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
        const [bestsellersResult] = await pool.execute(
            `SELECT
                p.id, p.name, p.price,
                SUM(oi.quantity) as total_sold,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE p.sector_id = ? AND o.created_at >= NOW() - INTERVAL 30 DAY AND p.is_active = true
             GROUP BY p.id, p.name, p.price
             ORDER BY total_sold DESC
             LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(bestsellersResult);
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
        const [newArrivalsResult] = await pool.execute(
            `SELECT
                p.id, p.name, p.price,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = ? AND p.is_active = true
             ORDER BY p.created_at DESC
             LIMIT 10`,
            [sectorId]
        );
        res.status(200).json(newArrivalsResult);
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
        const [results] = await pool.execute(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = ? AND p.is_active = true AND (p.name LIKE ? OR p.name LIKE ?)
             ORDER BY p.created_at DESC LIMIT 10`,
            [sectorId, '%feast%', '%family%']
        );
        res.status(200).json(results);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/sector/:sectorId/fruits-vegetables
// @desc    Get products tagged as 'fruit' or 'vegetable' in a specific sector
// @access  Public
router.get('/sector/:sectorId/fruits-vegetables', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const [results] = await pool.execute(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.sector_id = ? AND p.is_active = true AND (p.name LIKE ? OR p.name LIKE ?)
             ORDER BY p.created_at DESC LIMIT 10`,
            [sectorId, '%fruit%', '%vegetable%']
        );
        res.status(200).json(results);
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
        const [existingSector] = await pool.execute(
            'SELECT id FROM sectors WHERE name LIKE ?',
            [name]
        );

        if (existingSector.length > 0) {
            return res.status(409).json({ message: 'A sector with this name already exists.' });
        }

        // 3. Insert the new sector into the database
        const [result] = await pool.execute(
            `INSERT INTO sectors (name, image_url, hero_image_url, is_featured, display_order)
             VALUES (?, ?, ?, ?, ?)`,
            [
                name,
                image_url || null,
                hero_image_url || null,
                is_featured || false,
                display_order || 0
            ]
        );

        // Fetch the newly created sector
        const [newSector] = await pool.execute('SELECT * FROM sectors WHERE id = ?', [result.insertId]);

        // 4. Send a success response with the newly created sector object
        res.status(201).json({
            message: 'Sector created successfully.',
            sector: newSector[0]
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
        const [searchResult] = await pool.execute(
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
                    p.name LIKE ? OR
                    p.description LIKE ? OR
                    b.name LIKE ? OR
                    s.name LIKE ?
                )
             LIMIT 50`, // Limit results to prevent overwhelming the server
            [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]
        );

        res.status(200).json(searchResult);
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

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [productResult] = await connection.execute('SELECT sbo_id FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        if (userRole !== 'Admin' && productResult[0].sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to update this product.' });
        }

        await connection.execute(
            `UPDATE products SET 
                name = ?, description = ?, price = ?, stock_quantity = ?, sector_id = ?, brand_id = ?, is_active = ?,
                allow_backorder = ?, sale_price = ?, sale_start_date = ?, sale_end_date = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                name, description, price, stock_quantity, sector_id, brand_id, is_active,
                allow_backorder, sale_price, sale_start_date, sale_end_date,
                productId
            ]
        );

        const [updatedProduct] = await connection.execute('SELECT * FROM products WHERE id = ?', [productId]);

        await connection.commit();
        res.status(200).json({ message: 'Product updated successfully.', product: updatedProduct[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating product:', error);
        res.status(500).json({ message: 'Server error while updating product.' });
    } finally {
        connection.release();
    }
});


// @route   DELETE /api/products/:id (Admin Delete)
// @desc    Delete a product
// @access  Private (Admin or SBO)
router.delete('/:id', authenticateToken, checkRole(['Admin', 'SBO']), async (req, res) => {
    const { id: productId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const [productResult] = await pool.execute('SELECT sbo_id FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        if (userRole !== 'Admin' && productResult[0].sbo_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to delete this product.' });
        }

        await pool.execute('DELETE FROM products WHERE id = ?', [productId]);
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
        const [productResult] = await pool.execute(
            `SELECT 
                p.*, 
                b.name as brand_name, s.name as sector_name,
                sbop.company_name as sbo_company_name, sbop.contact_phone as sbo_contact_phone,
                sbop.contact_email as sbo_contact_email,
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
             WHERE p.id = ? AND p.is_active = true`,
            [id]
        );

        if (productResult.length === 0) return res.status(404).json({ message: 'Product not found.' });
        const product = productResult[0];

        // 2. Fetch all images for this product
        const [imagesResult] = await pool.execute('SELECT * FROM product_images WHERE product_id = ? ORDER BY display_order ASC', [id]);
        product.images = imagesResult;

        // 3. Fetch RELATED products (from the same sector, excluding the current product)
        if (product.sector_id) {
            const [relatedResult] = await pool.execute(
                `SELECT p.id, p.name, p.price, 
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
                 FROM products p
                 WHERE p.sector_id = ? AND p.id != ? AND p.is_active = true
                 LIMIT 4`,
                [product.sector_id, id]
            );
            product.related_products = relatedResult;
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
        const [products] = await pool.execute(
            `SELECT p.id, p.name, p.price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url FROM products p WHERE p.is_active = true ORDER BY p.created_at DESC LIMIT 20`
        );
        res.status(200).json(products);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/list/best-sellers
// @desc    Get the all-time best-selling products
// @access  Public
router.get('/list/best-sellers', async (req, res) => {
    try {
        const [products] = await pool.execute(
            `SELECT p.id, p.name, p.price, SUM(oi.quantity) as total_sold, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p JOIN order_items oi ON p.id = oi.product_id
             WHERE p.is_active = true GROUP BY p.id, p.name, p.price ORDER BY total_sold DESC LIMIT 20`
        );
        res.status(200).json(products);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// @route   GET /api/products/list/specials
// @desc    Get all products currently on sale
// @access  Public
router.get('/list/specials', async (req, res) => {
    try {
        const [products] = await pool.execute(
            `SELECT p.id, p.name, p.price, p.sale_price as active_price, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM products p
             WHERE p.is_active = true AND p.sale_price IS NOT NULL
             AND (p.sale_start_date IS NULL OR p.sale_start_date <= NOW())
             AND (p.sale_end_date IS NULL OR p.sale_end_date >= NOW())
             ORDER BY p.created_at DESC LIMIT 20`
        );
        res.status(200).json(products);
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// (You would add similar CRUD endpoints for Brands, Hero Slides, and Shop Sections)


export default router;