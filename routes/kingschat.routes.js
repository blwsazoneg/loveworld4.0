// routes/kingschat.routes.js
import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

const KINGSCHAT_API_URL = 'https://connect.kingsch.at/developer';

// --- NEW KINGSCHAT LOGIN ROUTE ---
router.post('/login', async (req, res) => {
    const { accessToken, refreshToken } = req.body;
    if (!accessToken) return res.status(400).json({
        message: 'KingsChat access token is required.'
    });

    try {
        const profileResponse = await axios.get(`${KINGSCHAT_API_URL}/api/profile`,
            {
                headers: { 'authorization': `Bearer ${accessToken}` }
            });
        const kcProfile = profileResponse.data.profile;
        const [userResult] = await pool.execute(
            `SELECT u.*, sp.id as sbo_profile_id
             FROM users u
             LEFT JOIN sbo_profiles sp ON u.id = sp.user_id
             WHERE u.kingschat_id = ?`,
            [kcProfile.id]
        );

        if (userResult.length > 0) {
            const user = userResult[0];

            if (refreshToken) {
                await pool.execute(
                    `UPDATE users 
                    SET kingschat_access_token = ?, 
                    kingschat_refresh_token = ?, 
                    updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?`,
                    [accessToken, refreshToken, user.id]
                );
            } else {
                await pool.execute(
                    `UPDATE users 
                    SET kingschat_access_token = ?, 
                    updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?`,
                    [accessToken, user.id]
                );
            }

            // Re-fetch the user data after the update to get the latest info
            const [updatedUserResult] = await pool.execute('SELECT * FROM users WHERE id = ?', [user.id]);
            const updatedUser = updatedUserResult[0];

            const appToken = jwt.sign(
                { id: updatedUser.id, role: updatedUser.role },
                process.env.JWT_SECRET,
                { expiresIn: '10h' }
            );

            // THE FIX IS HERE: We now build the COMPLETE user object
            res.status(200).json({
                message: 'Logged in successfully via KingsChat.',
                token: appToken,
                user: {
                    id: updatedUser.id, username: updatedUser.username, email: updatedUser.email, role: updatedUser.role, sbo_profile_id: user.sbo_profile_id, // keep sbo_profile_id from original join
                    firstName: updatedUser.first_name, lastName: updatedUser.last_name, dateOfBirth: updatedUser.date_of_birth,
                    phoneNumber: updatedUser.phone_number, kingschatHandle: updatedUser.kingschat_handle,
                    kingschatId: updatedUser.kingschat_id, kingschatGender: updatedUser.kingschat_gender,
                    kingschatAvatarUrl: updatedUser.kingschat_avatar_url, zone: updatedUser.zone, church: updatedUser.church,
                    ministryPosition: updatedUser.ministry_position, yearsInPosition: updatedUser.years_in_position,
                    group: updatedUser.group, leadership_role: updatedUser.leadership_role, ministry_staff: updatedUser.ministry_staff,
                    ministry_department: updatedUser.ministry_department, educational_qualification: updatedUser.educational_qualification,
                    institution_of_completion: updatedUser.institution_of_completion, professional_qualification: updatedUser.professional_qualification,
                    has_work_experience: updatedUser.has_work_experience, organisation_of_employment: updatedUser.organisation_of_employment,
                    duration_of_employment: updatedUser.duration_of_employment, significant_achievements: updatedUser.significant_achievements,
                    areas_of_interest: updatedUser.areas_of_interest, apply_for: updatedUser.apply_for
                }
            });

        } else {
            // User Does NOT Exist: REJECT the login attempt.
            // Send a 404 Not Found status with a clear message.
            return res.status(404).json({ message: 'No account on our platform is linked to this KingsChat profile. Please create an account first.' });
        }
    } catch (error) {
        console.error('KingsChat login error:', error);
        res.status(500).json({ message: 'An error occurred during KingsChat login.' });
    }
});

// REWRITTEN ENDPOINT: Receives accessToken directly
router.post('/link', authenticateToken, async (req, res) => {
    // We now expect 'accessToken' from the frontend
    const { accessToken } = req.body;
    const ourUserId = req.user.id;

    if (!accessToken) {
        return res.status(400).json({ message: 'KingsChat access token is required.' });
    }

    try {
        // Step 1: Use the received accessToken to fetch the KC user profile
        // (The code exchange step is no longer needed)
        const profileResponse = await axios.get(`${KINGSCHAT_API_URL}/api/profile`, {
            headers: {
                'authorization': `Bearer ${accessToken}`
            }
        });

        const kcProfile = profileResponse.data.profile;

        // Step 2: Update our user record in the database
        const birthDate = kcProfile.birth_date_millis ? new Date(kcProfile.birth_date_millis).toISOString().split('T')[0] : null;

        const [existingLink] = await pool.execute('SELECT id FROM users WHERE kingschat_id = ? AND id != ?', [kcProfile.id, ourUserId]);
        if (existingLink.length > 0) {
            return res.status(409).json({ message: 'This KingsChat account is already linked to another user.' });
        }

        // We only have the access token from this flow. We can't get the refresh token.
        // We will save the access token we received.
        await pool.execute(
            `UPDATE users SET
                kingschat_id = ?,
                kingschat_gender = ?,
                kingschat_avatar_url = ?,
                kingschat_access_token = ?, -- Save the token we got
                kingschat_handle = COALESCE(kingschat_handle, ?),
                first_name = COALESCE(NULLIF(first_name, ''), ?),
                last_name = COALESCE(NULLIF(last_name, ''), ?),
                email = COALESCE(NULLIF(email, ''), ?),
                phone_number = COALESCE(NULLIF(phone_number, ''), ?),
                date_of_birth = COALESCE(date_of_birth, ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [
                kcProfile.id,
                kcProfile.gender,
                kcProfile.avatar,
                accessToken, // Save the accessToken
                kcProfile.username,
                kcProfile.name.split(' ')[0] || '',
                kcProfile.name.split(' ').slice(1).join(' ') || '',
                kcProfile.email,
                kcProfile.phone_number,
                birthDate,
                ourUserId
            ]
        );

        const [updatedUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [ourUserId]);
        const user = updatedUser[0];
        const userToReturn = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            sbo_profile_id: user.sbo_profile_id,
            firstName: user.first_name,
            lastName: user.last_name,
            dateOfBirth: user.date_of_birth,
            phoneNumber: user.phone_number,
            kingschatHandle: user.kingschat_handle,
            kingschatId: user.kingschat_id,
            kingschatGender: user.kingschat_gender,
            kingschatAvatarUrl: user.kingschat_avatar_url,
            zone: user.zone,
            church: user.church,
            ministryPosition: user.ministry_position,
            yearsInPosition: user.years_in_position
        };

        res.status(200).json({
            message: 'KingsChat account linked successfully!',
            user: userToReturn
        });

    } catch (error) {
        console.error('KingsChat linking error:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'An error occurred while linking your KingsChat account.' });
    }
});

export default router;