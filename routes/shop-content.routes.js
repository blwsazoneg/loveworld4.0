// routes/shop-content.routes.js
import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// @route   GET /api/content/hero-slides
// @desc    Get all active hero slides for the shop homepage carousel
// @access  Public
router.get('/hero-slides', async (req, res) => {
    try {
        const [slides] = await pool.execute(
            `SELECT * FROM hero_slides WHERE is_active = true ORDER BY display_order ASC`
        );

        // For each slide, fetch its associated collage images
        for (const slide of slides) {
            const [collageResult] = await pool.execute(
                `SELECT * FROM hero_slide_collages WHERE slide_id = ? ORDER BY z_index ASC`,
                [slide.id]
            );
            slide.collage_images = collageResult; // Attach collage images to the slide object
        }

        res.status(200).json(slides);
    } catch (error) {
        console.error('Error fetching hero slides:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/content/weekly-bestsellers
// @desc    Get the top 4 best-selling products from the last 7 days
// @access  Public
router.get('/weekly-bestsellers', async (req, res) => {
    try {
        const [bestsellersResult] = await pool.execute(
            `SELECT
                p.id,
                p.name,
                p.price,
                SUM(oi.quantity) as total_sold,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE o.created_at >= NOW() - INTERVAL 7 DAY AND p.is_active = true
             GROUP BY p.id, p.name, p.price
             ORDER BY total_sold DESC
             LIMIT 4`
        );

        res.status(200).json(bestsellersResult);

    } catch (error) {
        console.error('Error fetching weekly bestsellers:', error);
        res.status(500).json({ message: 'Server error' });
    }
});



// @route   GET /api/content/shop-sections
// @desc    Get all active, scheduled shop sections and their products
// @access  Public
router.get('/shop-sections', async (req, res) => {
    try {
        const [sections] = await pool.execute(
            `SELECT * FROM shop_sections 
             WHERE is_active = true 
             AND (start_date IS NULL OR start_date <= NOW())
             AND (end_date IS NULL OR end_date >= NOW())
             AND title != 'Weekly Bestsellers' -- <-- THE FIX: Exclude this title
             ORDER BY display_order ASC
             LIMIT 2`
        );

        // The rest of the function remains the same
        for (const section of sections) {
            let productsResult = [];

            if (section.title === 'New Arrivals') {
                // DYNAMIC FETCH: Get 8 most recent active products
                [productsResult] = await pool.execute(
                    `SELECT p.*, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
                     FROM products p
                     WHERE p.is_active = true
                     ORDER BY p.created_at DESC
                     LIMIT 8`
                );
            } else {
                // MANUAL FETCH: Use section_products table
                [productsResult] = await pool.execute(
                    `SELECT p.*, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
                     FROM products p
                     JOIN section_products sp ON p.id = sp.product_id
                     WHERE sp.section_id = ? AND p.is_active = true`,
                    [section.id]
                );
            }

            section.products = productsResult;
        }

        res.status(200).json(sections);
    } catch (error) {
        console.error('Error fetching shop sections:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/content/featured-sectors
// @desc    Get all sectors marked as 'is_featured'
// @access  Public
router.get('/featured-sectors', async (req, res) => {
    try {
        const [sectors] = await pool.execute(
            `SELECT * FROM sectors 
            WHERE is_featured = true 
            ORDER BY RAND()`
        );
        res.status(200).json(sectors);
    } catch (error) {
        console.error('Error fetching featured sectors:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;