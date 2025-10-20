// routes/business.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js'; // We'll re-use our auth middleware

const router = express.Router();

// @route   POST /api/business/inquire
// @desc    Submit a new business inquiry
// @access  Private (requires user to be logged in)
router.post('/inquire', authenticateToken, async (req, res) => {
    const { regNumber, name, location } = req.body;
    const userId = req.user.id; // We get this from the authenticateToken middleware

    // Basic validation
    if (!name) {
        return res.status(400).json({ message: 'Registered Business Name is required.' });
    }

    try {
        const newInquiry = await pool.query(
            `INSERT INTO business_inquiries (business_reg_number, registered_business_name, operating_location, user_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [regNumber, name, location, userId]
        );

        res.status(201).json({
            message: 'Thank you! Your inquiry has been submitted successfully.',
            inquiry: newInquiry.rows[0]
        });

    } catch (error) {
        console.error('Business inquiry submission error:', error);
        res.status(500).json({ message: 'Server error. Please try again later.' });
    }
});

export default router;