// routes/job.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js'; // Import our new role middleware

const router = express.Router();

// @route   POST /api/jobs
// @desc    Create a new job post
// @access  Private (SBO or Admin)
router.post('/', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    const { title, description, tags } = req.body;
    const userId = req.user.id;

    if (!title || !description) {
        return res.status(400).json({ message: 'Title and description are required.' });
    }

    // Ensure tags is string (comma separated) or JSON string if needed.
    // Assuming tags is passed as array, we can join it or JSON stringify.
    // Schema says TEXT. I'll JSON stringify for consistency if it's an array.
    const tagsValue = Array.isArray(tags) ? JSON.stringify(tags) : tags;

    try {
        const [result] = await pool.execute(
            `INSERT INTO job_posts (title, description, tags, created_by_user_id)
             VALUES (?, ?, ?, ?)`,
            [title, description, tagsValue, userId]
        );
        const [newJob] = await pool.execute('SELECT * FROM job_posts WHERE id = ?', [result.insertId]);
        res.status(201).json(newJob[0]);
    } catch (error) {
        console.error('Error creating job post:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/jobs
// @desc    Get all active job posts with pagination and search
// @access  Public
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '10');
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    try {
        const queryParams = [];
        let whereClause = 'WHERE jp.is_active = true';

        if (searchTerm) {
            whereClause += ` AND (jp.title LIKE ? OR jp.description LIKE ? OR u.username LIKE ?)`; // Removed array ANY() check, simple text search
            queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
        }

        // Count query
        const countQuery = `
            SELECT COUNT(*) as count 
             FROM job_posts jp
             JOIN users u ON jp.created_by_user_id = u.id
             ${whereClause}
        `;
        // Use pool.query because of possible dynamic params order (though here it's simple)
        // Actually, for consistency let's use execute if possible, but count query params need to match.
        // I will use pool.query for safety with LIKE params.

        const [totalResult] = await pool.query(countQuery, queryParams);
        const totalJobs = parseInt(totalResult[0]?.count || 0);
        const totalPages = Math.ceil(totalJobs / limit);

        // Main Query
        const mainQuery = `SELECT jp.*, u.username as created_by_username
             FROM job_posts jp
             JOIN users u ON jp.created_by_user_id = u.id
             ${whereClause}
             ORDER BY jp.created_at DESC
             LIMIT ? OFFSET ?`;

        queryParams.push(limit);
        queryParams.push(offset);

        const [jobsResult] = await pool.query(mainQuery, queryParams);

        res.status(200).json({
            jobs: jobsResult,
            currentPage: page,
            totalPages: totalPages,
            totalJobs: totalJobs
        });
    } catch (error) {
        console.error('Error fetching job posts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/jobs/my-jobs
// @desc    Get all job posts created by the currently logged-in SBO/Admin
// @access  Private (SBO or Admin)
router.get('/my-jobs', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Authentication error: User ID not found.' });
    }
    const userId = req.user.id;
    try {
        const [jobsResult] = await pool.execute(
            `SELECT * FROM job_posts WHERE created_by_user_id = ? ORDER BY created_at DESC`,
            [userId]
        );
        res.status(200).json(jobsResult);
    } catch (error) {
        console.error('Error fetching user-specific job posts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// @route   GET /api/jobs/:id
// @desc    Get a single job post by its ID
// @access  Public
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [jobResult] = await pool.execute(
            `SELECT jp.*, u.username as created_by_username
             FROM job_posts jp
             JOIN users u ON jp.created_by_user_id = u.id
             WHERE jp.id = ? AND jp.is_active = true`,
            [id]
        );

        if (jobResult.length === 0) {
            return res.status(404).json({ message: 'Job post not found or is no longer active.' });
        }

        res.status(200).json(jobResult[0]);
    } catch (error) {
        console.error('Error fetching single job post:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/jobs/edit/:id
// @desc    Get a single job post for editing (checks ownership)
// @access  Private (SBO or Admin who owns the post)
router.get('/edit/:id', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    const { id: jobId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        const [jobResult] = await pool.execute('SELECT * FROM job_posts WHERE id = ?', [jobId]);
        if (jobResult.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const job = jobResult[0];

        // An SBO can only get their own posts. An Admin can get any post.
        if (userRole !== 'Admin' && job.created_by_user_id !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to access this post.' });
        }

        res.status(200).json(job);
    } catch (error) {
        console.error('Error fetching job for edit:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/jobs/:id
// @desc    Update a job post
// @access  Private (SBO or Admin who owns the post)
router.put('/:id', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    const { id: jobId } = req.params;
    const { title, description, tags, is_active } = req.body;
    const { id: userId, role: userRole } = req.user;

    if (!title || !description) {
        return res.status(400).json({ message: 'Title and description are required.' });
    }

    try {
        // First, verify ownership or admin status
        const [jobResult] = await pool.execute('SELECT created_by_user_id FROM job_posts WHERE id = ?', [jobId]);
        if (jobResult.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult[0].created_by_user_id;
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to update this post.' });
        }

        const tagsValue = Array.isArray(tags) ? JSON.stringify(tags) : tags;

        // Perform the update
        await pool.execute(
            `UPDATE job_posts 
             SET title = ?, description = ?, tags = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [title, description, tagsValue, is_active, jobId]
        );

        const [updatedJob] = await pool.execute('SELECT * FROM job_posts WHERE id = ?', [jobId]);

        res.status(200).json({
            message: 'Job post updated successfully.',
            job: updatedJob[0]
        });
    } catch (error) {
        console.error('Error updating job post:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/jobs/:id/apply
// @desc    Apply for a job
// @access  Private (Logged-in user)
router.post('/:id/apply', authenticateToken, async (req, res) => {
    const { id: jobId } = req.params;
    const { id: applicantId } = req.user;

    try {
        // The UNIQUE constraint in our database will automatically prevent duplicates.
        // The INSERT query will fail if the user has already applied.
        await pool.execute(
            `INSERT INTO job_applications (job_post_id, applicant_user_id) VALUES (?, ?)`,
            [jobId, applicantId]
        );

        res.status(201).json({ message: 'Application submitted successfully!' });
    } catch (error) {
        // Check for the unique violation error code '1062' (MySQL)
        if (error.code === '1062' || error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'You have already applied for this job.' });
        }
        console.error('Error applying for job:', error);
        res.status(500).json({ message: 'Server error during application.' });
    }
});

// @route   GET /api/jobs/:id/check-application
// @desc    Check if the current user has already applied for a job
// @access  Private (Logged-in user)
router.get('/:id/check-application', authenticateToken, async (req, res) => {
    const { id: jobId } = req.params;
    const { id: applicantId } = req.user;

    try {
        const [applicationResult] = await pool.execute(
            `SELECT id FROM job_applications WHERE job_post_id = ? AND applicant_user_id = ?`,
            [jobId, applicantId]
        );

        const hasApplied = applicationResult.length > 0;
        res.status(200).json({ hasApplied });
    } catch (error) {
        console.error('Error checking application status:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/jobs/:id
// @desc    Delete a job post
// @access  Private (SBO or Admin who owns the post)
router.delete('/:id', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    const { id: jobId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        // First, verify ownership or admin status
        const [jobResult] = await pool.execute('SELECT created_by_user_id FROM job_posts WHERE id = ?', [jobId]);
        if (jobResult.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult[0].created_by_user_id;

        // An SBO can only delete their own posts. An Admin can delete any post.
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to delete this post.' });
        }

        // Perform the deletion
        await pool.execute('DELETE FROM job_posts WHERE id = ?', [jobId]);

        res.status(200).json({ message: 'Job post deleted successfully.' });
    } catch (error) {
        console.error('Error deleting job post:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/jobs/:id/applicants
// @desc    Get all applicants for a specific job post
// @access  Private (SBO or Admin who owns the post)
router.get('/:id/applicants', authenticateToken, checkRole(['SBO', 'Admin']), async (req, res) => {
    const { id: jobId } = req.params;
    const { id: userId, role: userRole } = req.user;

    try {
        // First, verify that the job exists and that the current user owns it (or is an Admin)
        const [jobResult] = await pool.execute('SELECT created_by_user_id FROM job_posts WHERE id = ?', [jobId]);
        if (jobResult.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult[0].created_by_user_id;
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to view applicants for this post.' });
        }

        // Fetch the applicants' profile information
        const [applicantsResult] = await pool.execute(
            `SELECT
                u.id, u.first_name, u.last_name, u.username, u.email, u.phone_number,
                u.zone, u.church, u.ministry_position, u.kingschat_handle,
                ja.application_date, ja.applicant_user_id
             FROM job_applications ja
             JOIN users u ON ja.applicant_user_id = u.id
             WHERE ja.job_post_id = ?
             ORDER BY ja.application_date DESC`,
            [jobId]
        );

        res.status(200).json(applicantsResult);

    } catch (error) {
        console.error('Error fetching job applicants:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


export default router;