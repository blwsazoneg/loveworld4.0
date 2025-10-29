// routes/cart.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { getActivePricesForProducts } from '../utils/product.helpers.js';

const router = express.Router();

// Helper function to get or create a cart for the logged-in user
const getOrCreateCart = async (userId, client = pool) => {
    let cartResult = await client.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
        // If no cart exists, create one
        cartResult = await client.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [userId]);
    }
    return cartResult.rows[0].id;
};

// @route   POST /api/cart/items
// @desc    Add an item to the cart
// @access  Private
router.post('/items', authenticateToken, async (req, res) => {
    const { productId, quantity } = req.body;
    const userId = req.user.id;
    if (!productId || !quantity || quantity < 1) return res.status(400).json({ message: 'Invalid request.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. GET THE CURRENT STOCK AND PRODUCT INFO
        const productResult = await client.query('SELECT stock_quantity, allow_backorder FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) throw new Error('Product not found.');
        const { stock_quantity, allow_backorder } = productResult.rows[0];

        // 2. GET CURRENT QUANTITY IN CART
        const cartId = await getOrCreateCart(userId, client); // Pass client for transaction
        const cartItemResult = await client.query('SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
        const quantityInCart = cartItemResult.rows.length > 0 ? cartItemResult.rows[0].quantity : 0;

        // 3. VALIDATE THE REQUEST
        const requestedTotal = quantityInCart + quantity;
        if (requestedTotal > stock_quantity && !allow_backorder) {
            const availableToAdd = stock_quantity - quantityInCart;
            throw new Error(`Cannot add to cart. Only ${stock_quantity} item(s) in stock, and you have ${quantityInCart} in your cart. You can add ${availableToAdd > 0 ? availableToAdd : 0} more.`);
        }

        // 4. PERFORM THE UPSERT
        const query = `
            INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
            ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + $3
            RETURNING *;`;
        const newItem = await client.query(query, [cartId, productId, quantity]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Item added to cart.', item: newItem.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding item to cart:', error);
        res.status(400).json({ message: error.message }); // Send the specific error message to the frontend
    } finally {
        client.release();
    }
});

// @route   GET /api/cart
// @desc    Get the current user's cart contents
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId);

        // 1. Get the items in the cart
        const cartItemsResult = await pool.query(
            `SELECT ci.product_id, ci.quantity, p.name, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM cart_items ci JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`, [cartId]
        );
        const items = cartItemsResult.rows;

        // 2. Get the current, active prices for all products in the cart
        const productIds = items.map(item => item.product_id);
        const priceMap = await getActivePricesForProducts(productIds);

        // 3. Combine the cart items with their correct, live prices
        const itemsWithLivePrices = items.map(item => {
            const pricing = priceMap.get(item.product_id) || { active_price: 0, original_price: null };
            return {
                ...item,
                active_price: pricing.active_price,
                original_price: pricing.original_price
            };
        });

        res.status(200).json(itemsWithLivePrices);

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
    if (!quantity || quantity < 1) return res.status(400).json({ message: 'Invalid quantity.' });

    try {
        const productResult = await pool.query('SELECT stock_quantity, allow_backorder FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) return res.status(404).json({ message: 'Product not found.' });
        const { stock_quantity, allow_backorder } = productResult.rows[0];

        if (quantity > stock_quantity && !allow_backorder) {
            return res.status(400).json({ message: `Quantity cannot exceed available stock of ${stock_quantity}.` });
        }

        const cartId = await getOrCreateCart(userId);
        await pool.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3', [quantity, cartId, productId]);
        res.status(200).json({ message: 'Cart updated.' });
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