// loader.cjs
// This file serves as a CommonJS entry point for cPanel/LiteSpeed deployments.
// It bridges the gap between cPanel's 'require()' loader and our ES Module application.

import('./server.js')
    .then(module => {
        console.log('Server module loaded successfully via loader.cjs');
    })
    .catch(err => {
        console.error('Failed to load server.js:', err);
        process.exit(1);
    });
