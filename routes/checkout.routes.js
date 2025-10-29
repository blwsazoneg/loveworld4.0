// routes/checkout.routes.js
import express from 'express';
import Stripe from 'stripe';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import dotenv from 'dotenv';
import { getActivePricesForProducts } from '../utils/product.helpers.js';

dotenv.config();
const router = express.Router();

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// @route   POST /api/checkout/create-session
// @desc    Create a Stripe checkout session
// @access  Private
router.post('/create-session', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        // 1. Get the user's cart items from our database
        const cartResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
        if (cartResult.rows.length === 0) {
            return res.status(404).json({ message: 'No active cart found for this user.' });
        }
        const cartId = cartResult.rows[0].id;

        const cartItemsResult = await pool.query(
            `SELECT ci.product_id, p.name, p.description, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        if (cartItemsResult.rows.length === 0) {
            return res.status(400).json({
                message: 'Your cart is empty.'
            });
        }

        const cartItems = cartItemsResult.rows;

        for (const item of cartItems) {
            const stockResult = await pool.query('SELECT stock_quantity, allow_backorder FROM products WHERE id = $1', [item.product_id]);
            const { stock_quantity, allow_backorder } = stockResult.rows[0];
            if (item.quantity > stock_quantity && !allow_backorder) {
                return res.status(400).json({ message: `Checkout failed: The quantity for "${item.name}" exceeds the ${stock_quantity} available in stock. Please update your cart.` });
            }
        }

        if (cartItems.length === 0)
            return res.status(400).json({
                message: 'Your cart is empty.'
            });

        // THE FIX: Get live prices before creating the Stripe session
        const productIds = cartItems.map(item => item.product_id);
        const priceMap = await getActivePricesForProducts(productIds);

        // Format items for Stripe using the live active_price
        const line_items = cartItems.map(item => {
            const pricing = priceMap.get(item.product_id);
            if (!pricing) throw new Error(`Pricing not found for product ID ${item.product_id}`);

            return {
                price_data: {
                    currency: 'usd',
                    product_data: { name: item.name },
                    unit_amount: Math.round(pricing.active_price * 100), // USE THE CORRECT PRICE
                },
                quantity: item.quantity,
            };
        });

        // 3. Create the checkout session with Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: line_items,
            mode: 'payment',

            // THE FIX: The invalid 'currency_conversion' parameter has been removed.
            // Stripe's modern Checkout page handles multi-currency presentation by default.

            locale: 'auto', // This tells Stripe to auto-detect the user's language/region.

            success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/order-success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/cart.html`,
            metadata: { userId, cartId }
        });

        res.status(200).json({ id: session.id, url: session.url });

    } catch (error) {
        console.error('Stripe session creation error:', error);
        res.status(500).json({ message: 'Failed to create checkout session.' });
    }
});

// @route   POST /api/checkout/webhook
// @desc    Listen for events from Stripe
// @access  Public (but verified by Stripe)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`Webhook signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { userId, cartId } = session.metadata;

        // Use a database transaction for this critical operation
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Get all items from the user's cart
            const cartItemsResult = await client.query(
                `SELECT ci.product_id, ci.quantity, p.price 
                 FROM cart_items ci JOIN products p ON ci.product_id = p.id
                 WHERE ci.cart_id = $1`, [cartId]
            );
            const cartItems = cartItemsResult.rows;

            if (cartItems.length > 0) {
                // 2. Create a new Order and get its ID
                const newOrderResult = await client.query(
                    `INSERT INTO orders (user_id, total_amount, status, stripe_session_id) 
                     VALUES ($1, $2, 'paid', $3) RETURNING id`,
                    [userId, session.amount_total / 100, session.id]
                );
                const newOrderId = newOrderResult.rows[0].id;

                // 3. Loop through items, copy them to order_items, AND UPDATE STOCK
                for (const item of cartItems) {
                    // 3a. Copy to order_items
                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) 
                         VALUES ($1, $2, $3, $4)`,
                        [newOrderId, item.product_id, item.quantity, item.price]
                    );

                    // --- THIS IS THE CRITICAL FIX ---
                    // 3b. Decrement the stock_quantity in the products table
                    await client.query(
                        `UPDATE products 
                         SET stock_quantity = stock_quantity - $1 
                         WHERE id = $2`,
                        [item.quantity, item.product_id]
                    );
                }

                // 4. Clear the user's cart
                await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

                await client.query('COMMIT'); // Commit all changes
                console.log(`Order ${newOrderId} fulfilled, stock updated, and cart ${cartId} cleared.`);
            } else {
                // If the cart was somehow empty, just commit what we have (nothing)
                await client.query('COMMIT');
            }
        } catch (error) {
            await client.query('ROLLBACK'); // If any step fails, undo everything
            console.error('Error fulfilling order and updating stock:', error);
            return res.status(500).json({ message: 'Error fulfilling order.' });
        } finally {
            client.release(); // ALWAYS release the client
        }
    }

    res.status(200).json({ received: true });
});


export default router;