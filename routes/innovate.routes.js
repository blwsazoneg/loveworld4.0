// routes/innovate.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import multer from 'multer';
import path from 'path';

const router = express.Router();

//--- Multer Configuration ---
// This sets up where to store the files and how to name them.
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Store files in an 'uploads' folder in the project root
    },
    filename: function (req, file, cb) {
        // Create a unique filename to prevent overwrites: timestamp + original name
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
//--------------------------

// @route   POST /api/innovate/submit
// @desc    Submit a new innovation with optional files
// @access  Private (requires user to be logged in)
router.post(
    '/submit',
    authenticateToken,
    upload.array('files'), // Use multer to process up to 12 files with the field name 'files'
    async (req, res) => {
        const { description } = req.body;
        const userId = req.user.id;

        if (!description) {
            return res.status(400).json({ message: 'A description of the innovation is required.' });
        }

        // req.files is an array of file objects provided by multer
        // We map over it to get an array of just the file paths to store in the DB
        const filePaths = req.files ? req.files.map(file => file.path) : [];

        try {
            // MySQL: store file_paths as JSON string
            const filePathsJson = JSON.stringify(filePaths);

            const [result] = await pool.execute(
                `INSERT INTO innovations (description, file_paths, submitted_by_user_id)
                 VALUES (?, ?, ?)`,
                [description, filePathsJson, userId]
            );

            // Fetch the inserted record using insertId
            const [newInnovation] = await pool.execute('SELECT * FROM innovations WHERE id = ?', [result.insertId]);

            res.status(201).json({
                message: 'Your innovation has been submitted successfully!',
                submission: newInnovation[0]
            });

        } catch (error) {
            console.error('Innovation submission error:', error);
            res.status(500).json({ message: 'Server error. Please try again later.' });
        }
    }
);

export default router;