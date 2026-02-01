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

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let sectorId = null;
        if (sector_name) {
            const [sectorResult] = await connection.execute('SELECT id FROM sectors WHERE name LIKE ?', [sector_name]);
            if (sectorResult.length > 0) {
                sectorId = sectorResult[0].id;
            } else {
                const [newSectorResult] = await connection.execute('INSERT INTO sectors (name) VALUES (?)', [sector_name]);
                sectorId = newSectorResult.insertId;
            }
        }
        const coords = await geocodeAddress(address, city, country);
        if (!coords) throw new Error('Could not find coordinates for this address.');

        const [newVendorResult] = await connection.execute(
            `INSERT INTO vendor_locations (company_name, address, city, country, postal_code, sector_id, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [company_name, address, city, country, postal_code, sectorId, coords.lat, coords.lon]
        );

        const [newVendor] = await connection.execute('SELECT * FROM vendor_locations WHERE id = ?', [newVendorResult.insertId]);

        await connection.commit();
        res.status(201).json(newVendor[0]);
    } catch (error) {
        await connection.rollback();
        console.error('Error creating vendor:', error);
        res.status(500).json({ message: error.message || 'Server error.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/vendors
// @desc    Get all vendor locations
// @access  Public
router.get('/', async (req, res) => {
    try {
        const [vendors] = await pool.execute(
            `SELECT vl.*, s.name as sector_name FROM vendor_locations vl LEFT JOIN sectors s ON vl.sector_id = s.id ORDER BY vl.created_at DESC`
        );
        res.status(200).json(vendors);
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
        const [sectorResult] = await pool.execute('SELECT id FROM sectors WHERE name LIKE ?', [sector_name]);
        const sectorId = sectorResult.length > 0 ? sectorResult[0].id : null;

        const coords = await geocodeAddress(address, city, country);
        if (!coords) return res.status(400).json({ message: 'Could not find coordinates for the updated address.' });

        await pool.execute(
            `UPDATE vendor_locations SET company_name=?, address=?, city=?, country=?, postal_code=?, sector_id=?, latitude=?, longitude=? WHERE id=?`,
            [company_name, address, city, country, postal_code, sectorId, coords.lat, coords.lon, id]
        );

        const [updatedVendor] = await pool.execute('SELECT * FROM vendor_locations WHERE id = ?', [id]);

        res.status(200).json(updatedVendor[0]);
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
        await pool.execute('DELETE FROM vendor_locations WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Vendor location deleted successfully.' });
    } catch (error) {
        console.error('Error deleting vendor:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

export default router;