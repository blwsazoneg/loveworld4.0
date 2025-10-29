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

    try {
        const newJob = await pool.query(
            `INSERT INTO job_posts (title, description, tags, created_by_user_id)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [title, description, tags, userId]
        );
        res.status(201).json(newJob.rows[0]);
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
        // Query to get the paginated list of jobs
        const jobsResult = await pool.query(
            `SELECT jp.*, u.username as created_by_username
             FROM job_posts jp
             JOIN users u ON jp.created_by_user_id = u.id
             WHERE jp.is_active = true
             AND (jp.title ILIKE $1 OR jp.description ILIKE $1 OR u.username ILIKE $1 OR $1 = ANY(jp.tags))
             ORDER BY jp.created_at DESC
             LIMIT $2 OFFSET $3`,
            [`%${searchTerm}%`, limit, offset]
        );

        // Query to get the total count of jobs for pagination
        const totalResult = await pool.query(
            `SELECT COUNT(*) FROM job_posts
             WHERE is_active = true
             AND (title ILIKE $1 OR description ILIKE $1)`,
            [`%${searchTerm}%`]
        );

        const totalJobs = parseInt(totalResult.rows[0].count);
        const totalPages = Math.ceil(totalJobs / limit);

        res.status(200).json({
            jobs: jobsResult.rows,
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
        const jobsResult = await pool.query(
            `SELECT * FROM job_posts WHERE created_by_user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );
        res.status(200).json(jobsResult.rows);
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
        const jobResult = await pool.query(
            `SELECT jp.*, u.username as created_by_username
             FROM job_posts jp
             JOIN users u ON jp.created_by_user_id = u.id
             WHERE jp.id = $1 AND jp.is_active = true`,
            [id]
        );

        if (jobResult.rows.length === 0) {
            return res.status(404).json({ message: 'Job post not found or is no longer active.' });
        }

        res.status(200).json(jobResult.rows[0]);
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
        const jobResult = await pool.query('SELECT * FROM job_posts WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const job = jobResult.rows[0];

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
        const jobResult = await pool.query('SELECT created_by_user_id FROM job_posts WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult.rows[0].created_by_user_id;
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to update this post.' });
        }

        // Perform the update
        const updatedJob = await pool.query(
            `UPDATE job_posts 
             SET title = $1, description = $2, tags = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP
             WHERE id = $5 RETURNING *`,
            [title, description, tags, is_active, jobId]
        );

        res.status(200).json({
            message: 'Job post updated successfully.',
            job: updatedJob.rows[0]
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
        await pool.query(
            `INSERT INTO job_applications (job_post_id, applicant_user_id) VALUES ($1, $2)`,
            [jobId, applicantId]
        );

        res.status(201).json({ message: 'Application submitted successfully!' });
    } catch (error) {
        // Check for the unique violation error code '23505'
        if (error.code === '23505') {
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
        const applicationResult = await pool.query(
            `SELECT id FROM job_applications WHERE job_post_id = $1 AND applicant_user_id = $2`,
            [jobId, applicantId]
        );

        const hasApplied = applicationResult.rows.length > 0;
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
        const jobResult = await pool.query('SELECT created_by_user_id FROM job_posts WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult.rows[0].created_by_user_id;

        // An SBO can only delete their own posts. An Admin can delete any post.
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to delete this post.' });
        }

        // Perform the deletion
        await pool.query('DELETE FROM job_posts WHERE id = $1', [jobId]);

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
        const jobResult = await pool.query('SELECT created_by_user_id FROM job_posts WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
            return res.status(404).json({ message: 'Job post not found.' });
        }

        const jobOwnerId = jobResult.rows[0].created_by_user_id;
        if (userRole !== 'Admin' && jobOwnerId !== userId) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to view applicants for this post.' });
        }

        // Fetch the applicants' profile information
        const applicantsResult = await pool.query(
            `SELECT
                u.id, u.first_name, u.last_name, u.username, u.email, u.phone_number,
                u.zone, u.church, u.ministry_position, u.kingschat_handle,
                ja.application_date, ja.applicant_user_id
             FROM job_applications ja
             JOIN users u ON ja.applicant_user_id = u.id
             WHERE ja.job_post_id = $1
             ORDER BY ja.application_date DESC`,
            [jobId]
        );

        res.status(200).json(applicantsResult.rows);

    } catch (error) {
        console.error('Error fetching job applicants:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


export default router;