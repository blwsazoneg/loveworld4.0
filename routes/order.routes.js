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
    try {
        const ordersResult = await pool.query(
            `SELECT id, total_amount, status, created_at 
             FROM orders 
             WHERE user_id = $1 
             ORDER BY created_at DESC`,
            [userId]
        );
        res.status(200).json(ordersResult.rows);
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