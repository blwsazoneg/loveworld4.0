// public/js/utils.js
const introPages = [
    'index.html',
    'explore-the-loveworld-economy.html',
    'shop-made-in-loveworld.html',
    'discover-placements.html',
    'bring-innovations.html'
];

// Make the timer variable accessible in this file
let introTimer = null; 

export function startIntroTimer(currentPageFileName) {
    // Clear any existing timer before starting a new one
    if (introTimer) clearTimeout(introTimer);

    introTimer = setTimeout(() => {
        applyPageExitAnimation(() => {
            navigateToNextIntroPage(currentPageFileName);
        });
    }, 3000); // 3 seconds
}

export function stopIntroTimer() {
    if (introTimer) {
        console.log("Intro timer paused.");
        clearTimeout(introTimer);
    }
}

export function navigateToNextIntroPage(currentFileName) {
    const currentIndex = introPages.indexOf(currentFileName);
    if (currentIndex !== -1 && currentIndex < introPages.length - 1) {
        const nextFileName = introPages[currentIndex + 1];
        window.location.href = `/${nextFileName}`;
    } else {
        // All intro pages shown, navigate to the main information page
        window.location.href = '/information.html'; // We'll create this next
    }
}

// getCurrentPageIndex is now less critical for this specific navigation,
// but can remain for other potential uses if needed.
export function getCurrentPageIndex() {
    const path = window.location.pathname;
    const currentFileName = path.substring(path.lastIndexOf('/') + 1);
    return introPages.indexOf(currentFileName);
}


// Function to handle page transitions (slide up + fade) - remains the same
export function applyPageExitAnimation(callback) {
    const container = document.querySelector('.container');
    if (container) {
        container.classList.remove('fade-in');
        container.classList.add('slide-up-fade-out');
        // Wait for animation to complete before navigating
        container.addEventListener('animationend', () => {
            callback();
        }, { once: true });
    } else {
        callback(); // No animation element, just navigate
    }
}

// Function to reset initial animations for new page load (if reusing JS) - remains the same
export function resetPageEntryAnimation() {
    const container = document.querySelector('.container');
    if (container) {
        container.classList.remove('slide-up-fade-out');
        container.classList.add('fade-in');
    }
}