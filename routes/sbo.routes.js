// routes/sbo.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

const router = express.Router();

// @route   POST /api/sbo/apply
// @desc    A user applies to become an SBO
// @access  Private
router.post('/apply', authenticateToken, async (req, res) => {
    const { company_name, contact_phone, contact_email, kc_handle } = req.body;
    const userId = req.user.id;
    if (!company_name || !contact_email) return res.status(400).json({ message: 'Company name and email are required.' });
    try {
        await pool.query(
            'INSERT INTO sbo_profiles (user_id, company_name, contact_phone, contact_email, status, kc_handle) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO NOTHING',
            [userId, company_name, contact_phone, contact_email, 'pending', kc_handle]
        );
        res.status(201).json({ message: 'Your application has been submitted and is pending review.' });
    } catch (error) { res.status(500).json({ message: 'Server error.' }); }
});



export default router;