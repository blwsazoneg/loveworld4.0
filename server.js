import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import all our routes
import userRoutes from './routes/user.routes.js';
import kingschatRoutes from './routes/kingschat.routes.js';
import businessRoutes from './routes/business.routes.js';
import jobRoutes from './routes/job.routes.js';
import innovateRoutes from './routes/innovate.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes (These must come BEFORE the catch-all)
app.use('/api/users', userRoutes);
app.use('/api/kingschat', kingschatRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/innovate', innovateRoutes);

// --- THIS IS THE FIX ---
// For any GET request that isn't for an API route or a static file,
// serve the main index.html file. This allows the frontend to handle routing.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ----------------------

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Press Ctrl+C to stop');
});