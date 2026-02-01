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
        const [userExists] = await pool.execute(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (userExists.length > 0) {
            return res.status(409).json({ message: 'A user with this email or username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const [result] = await pool.execute(
            `INSERT INTO users (
                first_name, last_name, date_of_birth, email, phone_number,
                username, password_hash, kingschat_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                firstName, lastName, dateOfBirth || null, email, phoneNumber || null,
                username, passwordHash, kingschat_id || null
            ]
        );

        const newUserId = result.insertId;

        // Fetch the newly created user to return (simulating RETURNING)
        const [newUserRows] = await pool.execute(
            'SELECT id, username, email, role, first_name, last_name FROM users WHERE id = ?',
            [newUserId]
        );
        const newUser = newUserRows[0];

        const token = jwt.sign(
            { id: newUser.id, role: newUser.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: newUser
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
        const [userResult] = await pool.execute(
            `SELECT u.*, sp.id as sbo_profile_id 
             FROM users u
             LEFT JOIN sbo_profiles sp ON u.id = sp.user_id
             WHERE u.email = ? OR u.username = ?`,
            [identifier, identifier]
        );
        const user = userResult[0];
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '10h' });

        // THE FIX: Return EVERY field from the user object.
        res.status(200).json({
            message: 'Logged in successfully.',
            token,
            user: {
                id: user.id, username: user.username, email: user.email, role: user.role, sbo_profile_id: user.sbo_profile_id,
                firstName: user.first_name, lastName: user.last_name, dateOfBirth: user.date_of_birth,
                phoneNumber: user.phone_number, kingschatHandle: user.kingschat_handle,
                kingschatId: user.kingschat_id, kingschatGender: user.kingschat_gender,
                kingschatAvatarUrl: user.kingschat_avatar_url, zone: user.zone, church: user.church,
                ministryPosition: user.ministry_position, yearsInPosition: user.years_in_position,
                group: user.group, leadership_role: user.leadership_role,
                ministry_staff: Boolean(user.ministry_staff),
                ministry_department: user.ministry_department, educational_qualification: user.educational_qualification,
                institution_of_completion: user.institution_of_completion, professional_qualification: user.professional_qualification,
                has_work_experience: Boolean(user.has_work_experience),
                organisation_of_employment: user.organisation_of_employment,
                duration_of_employment: user.duration_of_employment,
                significant_achievements: typeof user.significant_achievements === 'string' && user.significant_achievements.startsWith('[')
                    ? JSON.parse(user.significant_achievements)
                    : (user.significant_achievements ? user.significant_achievements.split(',') : []),
                areas_of_interest: typeof user.areas_of_interest === 'string' && user.areas_of_interest.startsWith('[')
                    ? JSON.parse(user.areas_of_interest)
                    : (user.areas_of_interest ? user.areas_of_interest.split(',') : []),
                apply_for: user.apply_for
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
    const page = parseInt(req.query.page || '1');
    const limit = 15; // Show 15 users per page
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    try {
        let countQuery = 'SELECT COUNT(*) as count FROM users';
        let mainQuery = `
            SELECT id, first_name, last_name, username, email, role, created_at 
            FROM users
        `;
        const queryParams = [];

        // Add search conditions if a search term exists
        if (searchTerm) {
            queryParams.push(`%${searchTerm}%`);
            // Note: MySQL uses CONCAT for like '%term%', but prepared statement ? handles escaping, 
            // so we pass %term% as the value.
            const whereClause = ` WHERE username LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?`;
            mainQuery += whereClause;
            countQuery += whereClause;
            // We need to push the param 4 times for the 4 placeholders? 
            // Actually, for cleaner code, let's just handle the params array construction carefully.
        }

        // Re-construct params for correct count/main queries
        let countParams = [];
        if (searchTerm) {
            countParams = [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`];
        }

        // Get total count for pagination
        const [totalResult] = await pool.execute(countQuery, countParams);
        const totalUsers = parseInt(totalResult[0].count);
        const totalPages = Math.ceil(totalUsers / limit);

        // Get paginated users
        let mainParams = [...countParams];
        mainParams.push(limit);
        mainParams.push(offset);

        mainQuery += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

        // Note: LIMIT/OFFSET in MySQL prepared statements sometimes require integers, causing issues if passed as strings.
        // Ensuring they are numbers.
        const [usersResult] = await pool.query(mainQuery, mainParams);

        res.status(200).json({
            users: usersResult,
            currentPage: page,
            totalPages: totalPages
        });

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
        firstName,
        lastName,
        phoneNumber,
        zone,
        church,
        ministryPosition,
        yearsInPosition,
        // Detailed fields
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

    // Convert arrays to JSON strings for storage
    const significantAchievementsStr = Array.isArray(significant_achievements) ? JSON.stringify(significant_achievements) : significant_achievements;
    const areasOfInterestStr = Array.isArray(areas_of_interest) ? JSON.stringify(areas_of_interest) : areas_of_interest;

    // Fix: MySQL TINYINT stores boolean as 1/0. 
    // If we receive string "true" (which can happen), MySQL casts it to 0!
    // We must strictly convert to 1 or 0.
    const ministryStaffVal = (String(ministry_staff) === 'true' || ministry_staff === 1) ? 1 : 0;
    const hasWorkExperienceVal = (String(has_work_experience) === 'true' || has_work_experience === 1) ? 1 : 0;

    try {
        await pool.execute(
            `UPDATE users SET
                first_name = ?, last_name = ?, phone_number = ?,
                zone = ?, church = ?, ministry_position = ?, years_in_position = ?,
                \`group\` = ?, leadership_role = ?, ministry_staff = ?, ministry_department = ?,
                educational_qualification = ?, institution_of_completion = ?, professional_qualification = ?,
                has_work_experience = ?, organisation_of_employment = ?, duration_of_employment = ?,
                significant_achievements = ?, areas_of_interest = ?, apply_for = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [
                firstName, lastName, phoneNumber,
                zone, church, ministryPosition, yearsInPosition,
                group ?? null, leadership_role ?? null, ministryStaffVal, ministry_department ?? null,
                educational_qualification ?? null, institution_of_completion ?? null, professional_qualification ?? null,
                hasWorkExperienceVal, organisation_of_employment ?? null, duration_of_employment ?? null,
                significantAchievementsStr ?? null, areasOfInterestStr ?? null, apply_for ?? null,
                userId
            ]
        );

        // Retrieve updated user
        const [updatedUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);

        if (updatedUser.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Return the full, updated user object
        const user = updatedUser[0];
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
                group: user.group, leadership_role: user.leadership_role,
                ministry_staff: Boolean(user.ministry_staff),
                ministry_department: user.ministry_department, educational_qualification: user.educational_qualification,
                institution_of_completion: user.institution_of_completion, professional_qualification: user.professional_qualification,
                has_work_experience: Boolean(user.has_work_experience),
                organisation_of_employment: user.organisation_of_employment,
                duration_of_employment: user.duration_of_employment,
                // Fix: Parse these fields if they are strings (JSON or comma-separated)
                significant_achievements: typeof user.significant_achievements === 'string' && user.significant_achievements.startsWith('[')
                    ? JSON.parse(user.significant_achievements)
                    : (user.significant_achievements ? user.significant_achievements.split(',') : []),
                areas_of_interest: typeof user.areas_of_interest === 'string' && user.areas_of_interest.startsWith('[')
                    ? JSON.parse(user.areas_of_interest)
                    : (user.areas_of_interest ? user.areas_of_interest.split(',') : []),
                apply_for: user.apply_for
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
router.put('/:id/role', authenticateToken, checkRole(['Admin', 'Superadmin']), async (req, res) => { // Allow Superadmins
    const { id: targetUserId } = req.params;
    const { newRole } = req.body;
    const { id: currentAdminId, role: currentAdminRole } = req.user;

    // Fetch the target user's current role
    const [targetUserResult] = await pool.execute('SELECT role FROM users WHERE id = ?', [targetUserId]);
    if (targetUserResult.length === 0) return res.status(404).json({ message: 'User not found.' });
    const targetUserRole = targetUserResult[0].role;

    // --- NEW, ROBUST SECURITY RULES ---
    // 1. Nobody can change the role OF a Superadmin
    if (targetUserRole === 'Superadmin') {
        return res.status(403).json({ message: 'Forbidden: The Superadmin role cannot be changed.' });
    }
    // 2. Only a Superadmin can promote someone TO Admin
    if (newRole === 'Admin' && currentAdminRole !== 'Superadmin') {
        return res.status(403).json({ message: 'Forbidden: Only a Superadmin can create other Admins.' });
    }
    // 3. Admins/Superadmins cannot change their own role
    if (Number(targetUserId) === currentAdminId) {
        return res.status(400).json({ message: 'Error: You cannot change your own role.' });
    }

    const allowedRoles = ['User', 'SBO', 'Admin']; // Superadmin is not a role you can assign
    if (!newRole || !allowedRoles.includes(newRole)) return res.status(400).json({ message: 'Invalid role.' });

    try {
        await pool.execute(
            'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newRole, targetUserId]
        );

        const [updateUser] = await pool.execute('SELECT id, username, role FROM users WHERE id = ?', [targetUserId]);

        if (updateUser.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json({
            message: `User role successfully updated to ${newRole}.`,
            user: updateUser[0]
        });

    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ message: 'Server error while updating user role.' });
    }
});

export default router;