// routes/shop-content.routes.js
import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// @route   GET /api/content/hero-slides
// @desc    Get all active hero slides for the shop homepage carousel
// @access  Public
router.get('/hero-slides', async (req, res) => {
    try {
        const slidesResult = await pool.query(
            `SELECT * FROM hero_slides WHERE is_active = true ORDER BY display_order ASC`
        );
        const slides = slidesResult.rows;

        // For each slide, fetch its associated collage images
        for (const slide of slides) {
            const collageResult = await pool.query(
                `SELECT * FROM hero_slide_collages WHERE slide_id = $1 ORDER BY z_index ASC`,
                [slide.id]
            );
            slide.collage_images = collageResult.rows; // Attach collage images to the slide object
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
        const bestsellersResult = await pool.query(
            `SELECT
                p.id,
                p.name,
                p.price,
                SUM(oi.quantity) as total_sold,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE o.created_at >= NOW() - interval '7 days' AND p.is_active = true
             GROUP BY p.id
             ORDER BY total_sold DESC
             LIMIT 4`
        );

        res.status(200).json(bestsellersResult.rows);

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
        const sectionsResult = await pool.query(
            `SELECT * FROM shop_sections 
             WHERE is_active = true 
             AND (start_date IS NULL OR start_date <= NOW())
             AND (end_date IS NULL OR end_date >= NOW())
             AND title != 'Weekly Bestsellers' -- <-- THE FIX: Exclude this title
             ORDER BY display_order ASC
             LIMIT 2`
        );
        const sections = sectionsResult.rows;

        // The rest of the function remains the same
        for (const section of sections) {
            const productsResult = await pool.query(
                `SELECT p.*, (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
                 FROM products p
                 JOIN section_products sp ON p.id = sp.product_id
                 WHERE sp.section_id = $1 AND p.is_active = true`,
                [section.id]
            );
            section.products = productsResult.rows;
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
        const sectors = await pool.query(
            `SELECT * FROM sectors 
            WHERE is_featured = true 
            ORDER BY RANDOM()`
        );
        res.status(200).json(sectors.rows);
    } catch (error) {
        console.error('Error fetching featured sectors:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;