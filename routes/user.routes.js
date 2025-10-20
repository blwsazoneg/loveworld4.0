// routes/user.routes.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import dotenv from 'dotenv';
// --- 1. IMPORT THE MIDDLEWARES ---
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

dotenv.config();

const router = express.Router();

// User Registration
router.post('/register', async (req, res) => {
    // Only expect the simple fields for initial registration
    const {
        firstName,
        lastName,
        dateOfBirth,
        email,
        phoneNumber,
        username,
        password,
        kingschat_id // Still accept this if they came from a KC pre-fill
    } = req.body;

    // Basic validation
    if (!firstName || !lastName || !email || !username || !password) {
        return res.status(400).json({ message: 'Please fill all required fields.' });
    }

    try {
        const userExists = await pool.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );

        if (userExists.rows.length > 0) {
            return res.status(409).json({ message: 'A user with this email or username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            `INSERT INTO users (
                first_name, last_name, date_of_birth, email, phone_number,
                username, password_hash, kingschat_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, username, email, role, first_name, last_name`,
            [
                firstName, lastName, dateOfBirth || null, email, phoneNumber || null,
                username, passwordHash, kingschat_id || null
            ]
        );

        const token = jwt.sign(
            { id: newUser.rows[0].id, role: newUser.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: newUser.rows[0]
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// User Login (remains mostly the same, just returning more fields)
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body;
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [identifier]);
        const user = userResult.rows[0];
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '10h' });

        // THE FIX: Return EVERY field from the user object.
        res.status(200).json({
            message: 'Logged in successfully.',
            token,
            user: {
                id: user.id, username: user.username, email: user.email, role: user.role,
                firstName: user.first_name, lastName: user.last_name, dateOfBirth: user.date_of_birth,
                phoneNumber: user.phone_number, kingschatHandle: user.kingschat_handle,
                kingschatId: user.kingschat_id, kingschatGender: user.kingschat_gender,
                kingschatAvatarUrl: user.kingschat_avatar_url, zone: user.zone, church: user.church,
                ministryPosition: user.ministry_position, yearsInPosition: user.years_in_position,
                group: user.group, leadership_role: user.leadership_role, ministry_staff: user.ministry_staff,
                ministry_department: user.ministry_department, educational_qualification: user.educational_qualification,
                institution_of_completion: user.institution_of_completion, professional_qualification: user.professional_qualification,
                has_work_experience: user.has_work_experience, organisation_of_employment: user.organisation_of_employment,
                duration_of_employment: user.duration_of_employment, significant_achievements: user.significant_achievements,
                areas_of_interest: user.areas_of_interest, apply_for: user.apply_for
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// --- 2. ADD THE NEW ADMIN ROUTES ---

// @route   GET /api/users
// @desc    Get all users (for Admin dashboard)
// @access  Private (Admin only)
router.get('/', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        // Select all users but exclude passwords
        const usersResult = await pool.query(
            'SELECT id, first_name, last_name, username, email, role, created_at FROM users ORDER BY created_at DESC'
        );
        res.status(200).json(usersResult.rows);
    } catch (error) {
        console.error('Error fetching all users:', error);
        res.status(500).json({ message: 'Server error while fetching users.' });
    }
});

// @route   PUT /api/users/profile
// @desc    Update the logged-in user's own profile (for detailed application)
// @access  Private
router.put('/profile', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const {
        // We'll accept all the new detailed fields
        group,
        leadership_role,
        ministry_staff,
        ministry_department,
        educational_qualification,
        institution_of_completion,
        professional_qualification,
        has_work_experience,
        organisation_of_employment,
        duration_of_employment,
        significant_achievements,
        areas_of_interest,
        apply_for
    } = req.body;

    try {
        const updatedUser = await pool.query(
            `UPDATE users SET
                "group" = $1, leadership_role = $2, ministry_staff = $3, ministry_department = $4,
                educational_qualification = $5, institution_of_completion = $6, professional_qualification = $7,
                has_work_experience = $8, organisation_of_employment = $9, duration_of_employment = $10,
                significant_achievements = $11, areas_of_interest = $12, apply_for = $13,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $14
            RETURNING *`,
            [
                group, leadership_role, ministry_staff, ministry_department,
                educational_qualification, institution_of_completion, professional_qualification,
                has_work_experience, organisation_of_employment, duration_of_employment,
                significant_achievements, areas_of_interest, apply_for,
                userId
            ]
        );

        if (updatedUser.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Return the full, updated user object
        const user = updatedUser.rows[0];
        res.status(200).json({
            message: 'Your profile has been updated successfully!',
            user: {
                id: user.id, username: user.username, email: user.email, role: user.role,
                firstName: user.first_name, lastName: user.last_name, dateOfBirth: user.date_of_birth,
                phoneNumber: user.phone_number, kingschatHandle: user.kingschat_handle,
                kingschatId: user.kingschat_id, kingschatGender: user.kingschat_gender,
                kingschatAvatarUrl: user.kingschat_avatar_url, zone: user.zone, church: user.church,
                ministryPosition: user.ministry_position, yearsInPosition: user.years_in_position,
                // Also include the newly updated fields in the response
                group: user.group, leadership_role: user.leadership_role, ministry_staff: user.ministry_staff,
                ministry_department: user.ministry_department, educational_qualification: user.educational_qualification,
                institution_of_completion: user.institution_of_completion, professional_qualification: user.professional_qualification,
                has_work_experience: user.has_work_experience, organisation_of_employment: user.organisation_of_employment,
                duration_of_employment: user.duration_of_employment, significant_achievements: user.significant_achievements,
                areas_of_interest: user.areas_of_interest, apply_for: user.apply_for
            }
        });

    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server error while updating profile.' });
    }
});

// @route   PUT /api/users/:id/role
// @desc    Update a user's role
// @access  Private (Admin only)
router.put('/:id/role', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id: targetUserId } = req.params;
    const { newRole } = req.body;
    const adminUserId = req.user.id; // The ID of the admin making the change

    // Validate the new role to prevent arbitrary roles from being set
    const allowedRoles = ['User', 'SBO', 'Admin'];
    if (!newRole || !allowedRoles.includes(newRole)) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }

    // Prevent an admin from accidentally demoting themselves
    if (Number(targetUserId) === adminUserId) {
        return res.status(400).json({ message: 'Admins cannot change their own role.' });
    }

    try {
        const updateUser = await pool.query(
            'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, username, role',
            [newRole, targetUserId]
        );

        if (updateUser.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json({
            message: `User role successfully updated to ${newRole}.`,
            user: updateUser.rows[0]
        });

    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ message: 'Server error while updating user role.' });
    }
});

export default router;