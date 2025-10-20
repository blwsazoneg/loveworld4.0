// public/js/intro.js
import { navigateToNextIntroPage } from './utils.js'; // We'll create utils.js next

document.addEventListener('alpine:init', () => {
    // Optional: Alpine.js init if needed on the page itself
});

// Start the introductory sequence after 3 seconds
setTimeout(() => {
    navigateToNextIntroPage();
}, 3000);

// For demonstration, a simple function to navigate.
// In a real app, you might fetch page content or redirect.
// For now, let's keep it simple with redirects.