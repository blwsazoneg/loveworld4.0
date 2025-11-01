// routes/vendors.routes.js (DEFINITIVE, COMPLETE VERSION)

import express from 'express';
import pool from '../config/db.js';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { checkRole } from '../middleware/role.middleware.js';

const router = express.Router();

// Helper function for geocoding
const geocodeAddress = async (address, city, country) => {
    const searchQuery = [address, city, country].filter(Boolean).join(', ');
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`;

    try {
        const geoResponse = await axios.get(geocodeUrl, {
            headers: {
                'User-Agent': 'LoveworldApp/1.0',
                // THE FIX: Tell the API we want English results
                'accept-language': 'en'
            }
        });

        if (!geoResponse.data || geoResponse.data.length === 0) {
            return null;
        }

        return { lat: geoResponse.data[0].lat, lon: geoResponse.data[0].lon };

    } catch (error) {
        console.error("Geocoding failed:", error.message);
        return null;
    }
};

// @route   POST /api/vendors
// @desc    Admin creates a new vendor location
// @access  Private (Admin)
router.post('/', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { company_name, address, city, country, postal_code, sector_name } = req.body;
    if (!company_name || !city || !country) return res.status(400).json({ message: 'Company Name, City, and Country are required.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let sectorId = null;
        if (sector_name) {
            let sectorResult = await client.query('SELECT id FROM sectors WHERE name ILIKE $1', [sector_name]);
            if (sectorResult.rows.length > 0) {
                sectorId = sectorResult.rows[0].id;
            } else {
                const newSectorResult = await client.query('INSERT INTO sectors (name) VALUES ($1) RETURNING id', [sector_name]);
                sectorId = newSectorResult.rows[0].id;
            }
        }
        const coords = await geocodeAddress(address, city, country);
        if (!coords) throw new Error('Could not find coordinates for this address.');

        const newVendor = await client.query(
            `INSERT INTO vendor_locations (company_name, address, city, country, postal_code, sector_id, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [company_name, address, city, country, postal_code, sectorId, coords.lat, coords.lon]
        );
        await client.query('COMMIT');
        res.status(201).json(newVendor.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating vendor:', error);
        res.status(500).json({ message: error.message || 'Server error.' });
    } finally {
        client.release();
    }
});

// @route   GET /api/vendors
// @desc    Get all vendor locations
// @access  Public
router.get('/', async (req, res) => {
    try {
        const vendors = await pool.query(
            `SELECT vl.*, s.name as sector_name FROM vendor_locations vl LEFT JOIN sectors s ON vl.sector_id = s.id ORDER BY vl.created_at DESC`
        );
        res.status(200).json(vendors.rows);
    } catch (error) {
        console.error("Error fetching all vendors:", error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// @route   PUT /api/vendors/:id
// @desc    Admin updates a vendor location
// @access  Private (Admin)
router.put('/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    const { id } = req.params;
    const { company_name, address, city, country, postal_code, sector_name } = req.body;
    // (Note: This is a simplified update. A full update would also handle sector creation like the POST route)
    // For now, we assume the sector exists.
    try {
        const sectorResult = await pool.query('SELECT id FROM sectors WHERE name ILIKE $1', [sector_name]);
        const sectorId = sectorResult.rows.length > 0 ? sectorResult.rows[0].id : null;

        const coords = await geocodeAddress(address, city, country);
        if (!coords) return res.status(400).json({ message: 'Could not find coordinates for the updated address.' });

        const updatedVendor = await pool.query(
            `UPDATE vendor_locations SET company_name=$1, address=$2, city=$3, country=$4, postal_code=$5, sector_id=$6, latitude=$7, longitude=$8 WHERE id=$9 RETURNING *`,
            [company_name, address, city, country, postal_code, sectorId, coords.lat, coords.lon, id]
        );
        res.status(200).json(updatedVendor.rows[0]);
    } catch (error) {
        console.error('Error updating vendor:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// @route   DELETE /api/vendors/:id
// @desc    Admin deletes a vendor location
// @access  Private (Admin)
router.delete('/:id', authenticateToken, checkRole(['Admin']), async (req, res) => {
    try {
        await pool.query('DELETE FROM vendor_locations WHERE id = $1', [req.params.id]);
        res.status(200).json({ message: 'Vendor location deleted successfully.' });
    } catch (error) {
        console.error('Error deleting vendor:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

export default router;