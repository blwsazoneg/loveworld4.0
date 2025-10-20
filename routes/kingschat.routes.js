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
    if (!accessToken) return res.status(400).json({ message: 'KingsChat access token is required.' });

    try {
        const profileResponse = await axios.get(`${KINGSCHAT_API_URL}/api/profile`, { headers: { 'authorization': `Bearer ${accessToken}` } });
        const kcProfile = profileResponse.data.profile;
        const userResult = await pool.query('SELECT * FROM users WHERE kingschat_id = $1', [kcProfile.id]);


        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];

            if (refreshToken) {
                await pool.query(
                    `UPDATE users SET kingschat_access_token = $1, kingschat_refresh_token = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                    [accessToken, refreshToken, user.id]
                );
            } else {
                await pool.query(
                    `UPDATE users SET kingschat_access_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                    [accessToken, user.id]
                );
            }

            const appToken = jwt.sign(
                { id: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '10h' }
            );

            // Re-fetch the user data after the update to get the latest info
            const updatedUserResult = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
            const updatedUser = updatedUserResult.rows[0];

            // THE FIX IS HERE: We now build the COMPLETE user object
            res.status(200).json({
                message: 'Logged in successfully via KingsChat.',
                token: appToken,
                user: {
                    id: updatedUser.id, username: updatedUser.username, email: updatedUser.email, role: updatedUser.role,
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
            // This part for new users is unchanged
            res.status(206).json({
                message: 'No account is linked to this KingsChat profile. Please register.',
                kc_profile: {
                    firstName: kcProfile.name.split(' ')[0] || '',
                    lastName: kcProfile.name.split(' ').slice(1).join(' ') || '',
                    email: kcProfile.email,
                    phoneNumber: kcProfile.phone_number,
                    kingschatId: kcProfile.id,
                    kingschatAvatarUrl: kcProfile.avatar,
                    kingschatGender: kcProfile.gender,
                }
            });
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

        const existingLink = await pool.query('SELECT id FROM users WHERE kingschat_id = $1 AND id != $2', [kcProfile.id, ourUserId]);
        if (existingLink.rows.length > 0) {
            return res.status(409).json({ message: 'This KingsChat account is already linked to another user.' });
        }

        // We only have the access token from this flow. We can't get the refresh token.
        // We will save the access token we received.
        const updatedUser = await pool.query(
            `UPDATE users SET
                kingschat_id = $1,
                kingschat_gender = $2,
                kingschat_avatar_url = $3,
                kingschat_access_token = $4, -- Save the token we got
                kingschat_handle = COALESCE(kingschat_handle, $5),
                first_name = COALESCE(NULLIF(first_name, ''), $6),
                last_name = COALESCE(NULLIF(last_name, ''), $7),
                email = COALESCE(NULLIF(email, ''), $8),
                phone_number = COALESCE(NULLIF(phone_number, ''), $9),
                date_of_birth = COALESCE(date_of_birth, $10),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *`,
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

        const user = updatedUser.rows[0];
        const userToReturn = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
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