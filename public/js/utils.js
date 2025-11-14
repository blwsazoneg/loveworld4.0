// public/js/utils.js (NEW SINGLE-PAGE VERSION)

let introTimer = null;
let currentIndex = 0;

// This is now an array of the text strings to display
const introTexts = [
    "Welcome to Loveworld 4.0",
    "Explore the Loveworld Economy",
    "Shop Made in Loveworld",
    "Discover Strategic Placements",
    "Bring Innovations to Life"
];

// Function to start or continue the text animation cycle
export function startIntroCycle() {
    // Clear any existing timer to prevent overlaps
    stopIntroTimer();

    // Get the HTML element where the text is displayed
    const textElement = document.getElementById('animated-text');
    if (!textElement) return;

    // --- Main Animation Logic ---
    function animateText() {
        // 1. Apply the exit animation to the current text
        textElement.classList.add('slide-up-fade-out');

        // 2. Wait for the exit animation to finish
        setTimeout(() => {
            // 3. Increment the index
            currentIndex++;

            // 4. Check if we've reached the end of the text array
            if (currentIndex >= introTexts.length) {
                // If yes, navigate to the main information page
                window.location.href = '/information.html';
                return; // Stop the cycle
            }

            // 5. If not at the end, update the text content
            textElement.textContent = introTexts[currentIndex];

            // 6. Remove the exit animation class and trigger the entry animation
            textElement.classList.remove('slide-up-fade-out');

            // 7. Set the next timer
            introTimer = setTimeout(animateText, 3000);

        }, 500); // This delay should match the animation duration in the CSS
    }

    // Start the first timer
    introTimer = setTimeout(animateText, 3000);
}

// Function to stop the timer (e.g., when the modal opens)
export function stopIntroTimer() {
    if (introTimer) {
        clearTimeout(introTimer);
        introTimer = null;
        console.log("Intro cycle paused.");
    }
}