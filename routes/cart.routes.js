// routes/cart.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// Helper function to get or create a cart for the logged-in user
const getOrCreateCart = async (userId) => {
    let cartResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
        // If no cart exists, create one
        cartResult = await pool.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [userId]);
    }
    return cartResult.rows[0].id;
};

// @route   POST /api/cart/items
// @desc    Add an item to the cart
// @access  Private
router.post('/items', authenticateToken, async (req, res) => {
    const { productId, quantity } = req.body;
    const userId = req.user.id;

    if (!productId || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Product ID and a valid quantity are required.' });
    }

    try {
        const cartId = await getOrCreateCart(userId);

        // Use an "UPSERT" query:
        // If the product is already in the cart, update its quantity.
        // If it's not, insert it as a new item.
        const query = `
            INSERT INTO cart_items (cart_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (cart_id, product_id)
            DO UPDATE SET quantity = cart_items.quantity + $3
            RETURNING *;
        `;

        const newItem = await pool.query(query, [cartId, productId, quantity]);
        res.status(201).json({ message: 'Item added to cart successfully.', item: newItem.rows[0] });

    } catch (error) {
        console.error('Error adding item to cart:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/cart
// @desc    Get the current user's cart contents
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId);

        const cartItemsResult = await pool.query(
            `SELECT 
                ci.product_id, ci.quantity, 
                p.name, p.price,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) as main_image_url
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        res.status(200).json(cartItemsResult.rows);

    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/cart/items/:productId
// @desc    Update the quantity of an item in the cart
// @access  Private
router.put('/items/:productId', authenticateToken, async (req, res) => {
    const { productId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;

    if (!quantity || quantity < 1) {
        return res.status(400).json({ message: 'A valid quantity is required.' });
    }

    try {
        const cartId = await getOrCreateCart(userId);
        await pool.query(
            'UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3',
            [quantity, cartId, productId]
        );
        res.status(200).json({ message: 'Cart updated successfully.' });
    } catch (error) {
        console.error('Error updating cart item:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/cart/items/:productId
// @desc    Remove an item from the cart
// @access  Private
router.delete('/items/:productId', authenticateToken, async (req, res) => {
    const { productId } = req.params;
    const userId = req.user.id;

    try {
        const cartId = await getOrCreateCart(userId);
        await pool.query(
            'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, productId]
        );
        res.status(200).json({ message: 'Item removed from cart.' });
    } catch (error) {
        console.error('Error removing cart item:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// We will add routes for updating/deleting cart items later.

export default router;