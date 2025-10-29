// routes/order.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// @route   GET /api/orders/my-orders
// @desc    Get all orders for the currently logged-in user
// @access  Private
router.get('/my-orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '10');
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    try {
        // Start building the query and parameters
        let baseQuery = 'FROM orders WHERE user_id = $1';
        const queryParams = [userId];

        // Append search conditions if a search term exists
        if (searchTerm) {
            if (!isNaN(searchTerm)) {
                queryParams.push(searchTerm);
                baseQuery += ` AND id = $${queryParams.length}`;
            } else {
                queryParams.push(`${searchTerm}%`);
                baseQuery += ` AND CAST(created_at AS TEXT) ILIKE $${queryParams.length}`;
            }
        }

        // --- THE FIX IS HERE ---
        // We now build the final queries using the same base

        // 1. Build the query to get the total count
        const countQuery = `SELECT COUNT(*) ${baseQuery}`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalOrders = parseInt(totalResult.rows[0].count);
        const totalPages = Math.ceil(totalOrders / limit);

        // 2. Build the main query to get the paginated data
        // Add the ORDER BY, LIMIT, and OFFSET clauses with correct parameter placeholders
        queryParams.push(limit);
        queryParams.push(offset);
        const mainQuery = `
            SELECT id, total_amount, status, created_at 
            ${baseQuery} 
            ORDER BY created_at DESC 
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `;

        const ordersResult = await pool.query(mainQuery, queryParams);

        res.status(200).json({
            orders: ordersResult.rows,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/orders/:id
// @desc    Get details for a single order, including its items
// @access  Private (and checks for ownership)
router.get('/:id', authenticateToken, async (req, res) => {
    const { id: orderId } = req.params;
    const userId = req.user.id;
    try {
        // 1. Fetch the main order details and verify the user owns it
        const orderResult = await pool.query(
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [orderId, userId]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found or you do not have permission to view it.' });
        }
        const order = orderResult.rows[0];

        // 2. Fetch the items associated with this order
        const itemsResult = await pool.query(
            `SELECT oi.quantity, oi.price_at_purchase, p.name, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [orderId]
        );

        order.items = itemsResult.rows;
        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;