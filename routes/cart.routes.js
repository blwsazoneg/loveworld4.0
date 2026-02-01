// routes/cart.routes.js
import express from 'express';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { getActivePricesForProducts } from '../utils/product.helpers.js';

const router = express.Router();

// Helper function to get or create a cart for the logged-in user
const getOrCreateCart = async (userId, connection) => {
    // If no connection is passed, use a new one from pool (implied usage below handles this)
    // But better to pass connection if in transaction.
    const db = connection || pool;
    // pool.execute returns [rows]. connection.execute returns [rows].

    let [cartResult] = await db.execute('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (cartResult.length === 0) {
        // If no cart exists, create one
        const [insertResult] = await db.execute('INSERT INTO carts (user_id) VALUES (?)', [userId]);
        // Return correct ID
        return insertResult.insertId;
    }
    return cartResult[0].id;
};

// @route   POST /api/cart/items
// @desc    Add an item to the cart
// @access  Private
router.post('/items', authenticateToken, async (req, res) => {
    const { productId, quantity } = req.body;
    const userId = req.user.id;
    if (!productId || !quantity || quantity < 1) return res.status(400).json({ message: 'Invalid request.' });

    const connection = await pool.getConnection(); // Use manual connection for transaction
    try {
        await connection.beginTransaction();

        // 1. GET THE CURRENT STOCK AND PRODUCT INFO
        const [productResult] = await connection.execute('SELECT stock_quantity, allow_backorder FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) throw new Error('Product not found.');
        const { stock_quantity, allow_backorder } = productResult[0];

        // 2. GET CURRENT QUANTITY IN CART
        const cartId = await getOrCreateCart(userId, connection); // Pass connection
        const [cartItemResult] = await connection.execute('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, productId]);
        const quantityInCart = cartItemResult.length > 0 ? cartItemResult[0].quantity : 0;

        // 3. VALIDATE THE REQUEST
        const requestedTotal = quantityInCart + quantity;
        if (requestedTotal > stock_quantity && !allow_backorder) {
            const availableToAdd = stock_quantity - quantityInCart;
            throw new Error(`Cannot add to cart. Only ${stock_quantity} item(s) in stock, and you have ${quantityInCart} in your cart. You can add ${availableToAdd > 0 ? availableToAdd : 0} more.`);
        }

        // 4. PERFORM THE UPSERT
        // MySQL uses ON DUPLICATE KEY UPDATE.
        // Assuming (cart_id, product_id) is unique/PK.
        const query = `
            INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`;
        // In MySQL 8.0.20+ VALUES() is deprecated, use aliases.
        // INSERT INTO ... VALUES (?,?,?) AS new ON DUPLICATE KEY UPDATE quantity = quantity + new.quantity
        // Or simple `quantity = quantity + ?` passing quantity again?
        // Let's use standard VALUES for compatibility or just `quantity = quantity + ?` logic.
        // Actually `quantity = quantity + ?` implies adding the new amount. Yes.

        await connection.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?', [cartId, productId, quantity, quantity]);
        // We can't easily "RETURNING *" in MySQL.
        // But we can just return what we put in or fetch it.
        // Fetched data is often needed for frontend state.

        const [newItem] = await connection.execute('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, productId]);

        await connection.commit();
        res.status(201).json({ message: 'Item added to cart.', item: newItem[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Error adding item to cart:', error);
        res.status(400).json({ message: error.message }); // Send the specific error message to the frontend
    } finally {
        connection.release();
    }
});

// @route   GET /api/cart
// @desc    Get the current user's cart contents
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(userId, pool); // Pass pool as 'connection'

        // 1. Get the items in the cart
        const [cartItemsResult] = await pool.execute(
            `SELECT ci.product_id, ci.quantity, p.name, 
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as main_image_url
             FROM cart_items ci JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = ?`, [cartId]
        );
        const items = cartItemsResult;

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
        const [productResult] = await pool.execute('SELECT stock_quantity, allow_backorder FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0) return res.status(404).json({ message: 'Product not found.' });
        const { stock_quantity, allow_backorder } = productResult[0];

        if (quantity > stock_quantity && !allow_backorder) {
            return res.status(400).json({ message: `Quantity cannot exceed available stock of ${stock_quantity}.` });
        }

        const cartId = await getOrCreateCart(userId, pool);
        await pool.execute('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?', [quantity, cartId, productId]);
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
        const cartId = await getOrCreateCart(userId, pool);
        await pool.execute(
            'DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?',
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