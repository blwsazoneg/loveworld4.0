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
        let baseQuery = 'FROM orders WHERE user_id = ?';
        const queryParams = [userId];

        // Append search conditions if a search term exists
        if (searchTerm) {
            // Check if search term is a number (for ID search)
            if (!isNaN(searchTerm)) {
                queryParams.push(searchTerm);
                baseQuery += ` AND id = ?`;
            } else {
                queryParams.push(`${searchTerm}%`);
                // MySQL cast created_at to char
                baseQuery += ` AND CAST(created_at AS CHAR) LIKE ?`;
            }
        }

        // 1. Build the query to get the total count
        const countQuery = `SELECT COUNT(*) as count ${baseQuery}`;
        // We need to use execute/query. Since we are building dynamic query with params, execute works if params match ? count.
        // For dynamic queries relying on appending ?, `pool.query` in mysql2 is often safer or ensuring order correct.
        // Here params order is preserved.
        const [totalResult] = await pool.query(countQuery, queryParams);
        const totalOrders = parseInt(totalResult[0]?.count || 0);
        const totalPages = Math.ceil(totalOrders / limit);

        // 2. Build the main query to get the paginated data
        queryParams.push(limit);
        queryParams.push(offset);
        const mainQuery = `
            SELECT id, total_amount, status, created_at 
            ${baseQuery} 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;

        const [ordersResult] = await pool.query(mainQuery, queryParams);

        res.status(200).json({
            orders: ordersResult,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack });
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
        const [orderResult] = await pool.execute(
            'SELECT * FROM orders WHERE id = ? AND user_id = ?',
            [orderId, userId]
        );

        if (orderResult.length === 0) {
            return res.status(404).json({ message: 'Order not found or you do not have permission to view it.' });
        }
        const order = orderResult[0];

        // 2. Fetch the items associated with this order
        const [itemsResult] = await pool.execute(
            `SELECT oi.quantity, oi.price_at_purchase, p.name, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        order.items = itemsResult;
        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;