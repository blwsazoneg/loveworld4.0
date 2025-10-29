// utils/product.helpers.js
import pool from '../config/db.js';

/**
 * A robust function to get the current, correct price for a list of products.
 * This is the SINGLE SOURCE OF TRUTH for pricing.
 * @param {Array<number>} productIds - An array of product IDs to check.
 * @returns {Map<number, {active_price: number, original_price: number|null}>} A map where the key is the product ID and the value is its pricing info.
 */
export const getActivePricesForProducts = async (productIds) => {
    if (!productIds || productIds.length === 0) {
        return new Map();
    }

    const priceQuery = `
        SELECT 
            id,
            price,
            sale_price,
            CASE
                WHEN sale_price IS NOT NULL AND (sale_start_date IS NULL OR sale_start_date <= NOW()) AND (sale_end_date IS NULL OR sale_end_date >= NOW())
                THEN sale_price
                ELSE price
            END as active_price,
            CASE
                WHEN sale_price IS NOT NULL AND (sale_start_date IS NULL OR sale_start_date <= NOW()) AND (sale_end_date IS NULL OR sale_end_date >= NOW())
                THEN price
                ELSE NULL
            END as original_price
        FROM products
        WHERE id = ANY($1::int[])
    `;

    const pricesResult = await pool.query(priceQuery, [productIds]);

    // Convert the result array into a Map for easy lookup (e.g., prices.get(productId))
    const priceMap = new Map();
    for (const row of pricesResult.rows) {
        priceMap.set(row.id, {
            active_price: parseFloat(row.active_price),
            original_price: row.original_price ? parseFloat(row.original_price) : null,
        });
    }

    return priceMap;
};