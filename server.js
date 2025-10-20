// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import userRoutes from './routes/user.routes.js'; // Import user routes
import kingschatRoutes from './routes/kingschat.routes.js'; // Import KingsChat routes
import businessRoutes from './routes/business.routes.js'; // Import business routes
import jobRoutes from './routes/job.routes.js'; // Import job routes
import innovateRoutes from './routes/innovate.routes.js'; // Import innovate routes
import e from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV === 'production') {
    const buildPath = path.resolve(__dirname, 'dist');
    app.use(express.static(buildPath));

    app.get('*', (req, res) => {
        res.sendFile(path.join(buildPath, 'index.html'));
    });
}
// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve Uploads folder
express.static(path.join(__dirname, 'uploads'));

// Use user routes for API endpoints
app.use('/api/users', userRoutes); // All user-related API calls will be under /api/users
app.use('/api/kingschat', kingschatRoutes); // All KingsChat-related API calls will be under /api/kingschat
app.use('/api/business', businessRoutes); // All business-related API calls will be under /api/business
app.use('/api/jobs', jobRoutes); // All job-related API calls will be under /api/jobs
app.use('/api/innovate', innovateRoutes); // All innovation-related API calls will be under /api/innovate

// Basic route - will serve public/welcome.html as the root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for other HTML pages (to prevent "Cannot GET" errors for non-API routes)
// This serves any .html file directly if requested by its name,
// provided it exists in the public directory.
app.get('/:page.html', (req, res) => {
    const pagePath = path.join(__dirname, 'public', `${req.params.page}.html`);
    res.sendFile(pagePath, (err) => {
        if (err) {
            console.error(`Error serving ${req.params.page}.html:`, err);
            res.status(404).send('Page Not Found');
        }
    });
});


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Press Ctrl+C to stop');
});