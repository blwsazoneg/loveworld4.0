import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import all our routes
import userRoutes from './routes/user.routes.js';
import kingschatRoutes from './routes/kingschat.routes.js';
import businessRoutes from './routes/business.routes.js';
import jobRoutes from './routes/job.routes.js';
import innovateRoutes from './routes/innovate.routes.js';
import productRoutes from './routes/product.routes.js';
import shopContentRoutes from './routes/shop-content.routes.js';
import cartRoutes from './routes/cart.routes.js';
import checkoutRoutes from './routes/checkout.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js'; // <-- 1. IMPORT
import sboRoutes from './routes/sbo.routes.js';
import vendorRoutes from './routes/vendors.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use('/api/checkout', checkoutRoutes);


// Middleware
app.use(express.json());

// API Routes (These must come first)
app.use('/api/users', userRoutes);
app.use('/api/kingschat', kingschatRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/innovate', innovateRoutes);
app.use('/api/products', productRoutes);
app.use('/api/content', shopContentRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes); // <-- 2. USE THE NEW ADMIN ROUTE
app.use('/api/sbo', sboRoutes);
app.use('/api/vendors', vendorRoutes);

// Serve static assets from the 'public' and 'uploads' folders
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// --- THIS IS THE DEFINITIVE FIX ---
// This catch-all route uses a regular expression.
// It matches any route that does NOT start with '/api/' and does NOT contain a dot (.),
// which means it will catch frontend routes like '/placements' or '/profile'
// but ignore requests for files like 'style.css' or 'main.js'.
app.get(/^\/(?!api).*/, (req, res) => {
    // Check if the path looks like a file request
    if (path.extname(req.path).length > 0) {
        // If it looks like a file, let the static middleware handle it or 404
        return res.status(404).end();
    }
    // For all other frontend routes, serve the main HTML file.
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ---------------------------------


// =======================================================
// NEW 404 NOT FOUND HANDLER
// This middleware will run if no other route is matched.
// It MUST be the last middleware added before app.listen().
// =======================================================
app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});