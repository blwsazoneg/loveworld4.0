import { registerUser, loginUser } from './auth.js';

// --- NEW GLOBAL HELPER FUNCTION ---
function formatPrice(price) {
    if (price === null || price === undefined || isNaN(price)) {
        return ''; // Return an empty string if there's no price
    }
    // For now, we use the store's base currency (USD).
    // This could be made dynamic later by passing in a currency code.
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(price);
};

// ================================================================
// NEW! GLOBAL AXIOS ERROR INTERCEPTOR
// This code runs on EVERY API response.
// ================================================================
axios.interceptors.response.use(
    // If the response is successful (status 2xx), just pass it through.
    response => response,

    // If the response has an error...
    error => {
        // Check if the error is specifically a 401 Unauthorized or 403 Forbidden
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Check if the user THINKS they are logged in.
            if (Alpine.store('auth').loggedIn) {
                console.log('Session expired or token invalid. Forcing logout.');

                // 1. Force the user to log out on the frontend.
                Alpine.store('auth').logout();

                // 2. We need to find the authModal to show a message and open it.
                // We use a trick with dispatching a custom event.
                window.dispatchEvent(new CustomEvent('session-expired'));
            }
        }

        // Return the error to the original Promise chain so that
        // individual components can still handle other types of errors.
        return Promise.reject(error);
    }
);

document.addEventListener('alpine:init', () => {

    //================================================================
    // 1. GLOBAL AUTHENTICATION STORE
    // This is the single source of truth for the user's login state.
    // Accessible on any page with '$store.auth'.
    //================================================================
    Alpine.store('auth', {
        loggedIn: false,
        user: null,
        token: null,

        // --- ADD THIS NEW HELPER FUNCTION ---
        hasRole(requiredRole) {
            if (!this.loggedIn || !this.user.role) {
                return false;
            }

            const userRole = this.user.role;

            // Define the same hierarchy on the frontend
            const ROLES = {
                User: [],
                SBO: ['User'],
                Admin: ['SBO'],
                Superadmin: ['Admin']
            };

            // Recursive check
            function check(current, required) {
                if (current === required) return true;
                const inherited = ROLES[current];
                if (inherited && inherited.length > 0) {
                    return inherited.some(r => check(r, required));
                }
                return false;
            }

            return check(userRole, requiredRole);
        },


        // Helper function to centralize what happens on a successful login
        handleSuccessfulLogin(data) {
            this.token = data.token;
            this.user = data.user;
            this.loggedIn = true;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));
            console.log('Login successful. User state updated:', this.user);
        },

        // Checks localStorage when the app loads to see if the user is already logged in
        initialize() {
            const token = localStorage.getItem('token');
            const user = localStorage.getItem('user');
            if (token && user) {
                this.token = token;
                this.user = JSON.parse(user);
                this.loggedIn = true;
                console.log('User initialized from localStorage:', this.user);
            }
        },

        // Handles regular username/password login
        async login(identifier, password) {
            const result = await loginUser({ identifier, password });
            if (result.success) {
                this.handleSuccessfulLogin(result.data); // Use the helper
                return { success: true, message: result.data.message };
            } else {
                return { success: false, message: result.message };
            }
        },

        // Handles logout
        logout() {
            this.loggedIn = false;
            this.user = null;
            this.token = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            console.log('User logged out.');
            window.location.href = '/information.html';
        },

        // Updates user data in the store (e.g., after linking KC on profile page)
        updateUser(newUserData) {
            this.user = newUserData;
            localStorage.setItem('user', JSON.stringify(newUserData));
            console.log('User data updated in store:', this.user);
        }
    });

    //================================================================
    // 2. AUTH MODAL COMPONENT
    // This powers the login/registration popup modal used on all pages.
    //================================================================
    Alpine.data('authModal', () => ({
        showRegisterForm: false,
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        email: '',
        phoneNumber: '',
        username: '',
        password: '',
        confirmPassword: '',
        registerMessage: '',
        registerError: false,
        loginIdentifier: '',
        loginPassword: '',
        loginMessage: '',
        loginError: false,
        kc_profile_id: null,
        kc_avatar_url: null,

        init() {
            // Listen for the custom 'session-expired' event from our interceptor
            window.addEventListener('session-expired', () => {
                // Set a clear message for the user
                this.loginMessage = 'Your session has expired. Please log in again.';
                this.loginError = true; // Use the error styling for the message
                this.showRegisterForm = false; // Make sure the login form is visible

                // Open the modal
                const modal = new bootstrap.Modal(this.$el);
                modal.show();
            });
        },

        async loginWithKingsChat() {
            this.loginMessage = 'Connecting to KingsChat...'; this.loginError = false;
            const loginOptions = { scopes: ["profile"], clientId: 'b2b522e9-d602-402d-b61d-8a50825862da' };
            try {
                const response = await window.kingsChatWebSdk.login(loginOptions);
                const { accessToken, refreshToken } = response;
                if (!accessToken) throw new Error("Access Token not found.");
                const backendResponse = await axios.post('/api/kingschat/login', { accessToken, refreshToken });
                Alpine.store('auth').handleSuccessfulLogin(backendResponse.data);
                this.loginMessage = backendResponse.data.message; this.loginError = false;
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('signInUpModal'));
                if (modalInstance) modalInstance.hide();
            } catch (error) {
                if (error.response && error.response.status === 206) {
                    const kc_profile = error.response.data.kc_profile;
                    this.firstName = kc_profile.firstName; this.lastName = kc_profile.lastName;
                    this.email = kc_profile.email; this.phoneNumber = kc_profile.phoneNumber;
                    this.kc_profile_id = kc_profile.kingschatId; this.kc_avatar_url = kc_profile.kingschatAvatarUrl;
                    this.registerMessage = 'Profile found! Please complete your registration.'; this.registerError = false;
                    this.showRegisterForm = true;
                } else {
                    this.loginMessage = error.response ? error.response.data.message : 'KingsChat login failed.';
                    this.loginError = true;
                }
            }
        },

        async handleRegister() {
            if (this.password !== this.confirmPassword) {
                this.registerMessage = 'Passwords do not match.'; this.registerError = true;
                return;
            }
            const userData = {
                firstName: this.firstName, lastName: this.lastName, dateOfBirth: this.dateOfBirth,
                email: this.email, phoneNumber: this.phoneNumber, username: this.username, password: this.password,
                kingschat_id: this.kc_profile_id
            };
            const result = await registerUser(userData);
            if (result.success) {
                this.registerMessage = result.data.message + " You can now log in."; this.registerError = false;
                this.showRegisterForm = false;
            } else {
                this.registerMessage = result.message; this.registerError = true;
            }
        },

        async handleLogin() {
            const result = await Alpine.store('auth').login(this.loginIdentifier, this.loginPassword);
            if (result.success) {
                this.loginMessage = result.message; this.loginError = false;
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('signInUpModal'));
                if (modalInstance) modalInstance.hide();
            } else {
                this.loginMessage = result.message; this.loginError = true;
            }
        }
    }));

    //================================================================
    // 3. PROFILE PAGE COMPONENT
    // This powers the logic on the /profile.html page specifically.
    //================================================================
    Alpine.data('profilePage', () => ({
        // 'user' is for display, 'formData' is for editing
        user: {},
        formData: {},
        isEditing: false,

        // For the multi-tag input
        interestInput: '',

        // State for linking KingsChat
        kcMessage: '',
        kcError: false,

        // State for saving the profile
        saveMessage: '',
        saveError: false,
        saveLoading: false,

        sboFormData: {
            company_name: '',
            contact_phone: '',
            contact_email: '',
            kc_handle: null
        },

        sboApplyMessage: '',
        sboApplyError: false,
        sboApplyLoading: false,

        init() {
            // Watch for changes to the global user store and update the local display
            this.$watch('$store.auth.user', (newUser) => {
                this.user = JSON.parse(JSON.stringify(newUser || {}));
            });
            this.user = JSON.parse(JSON.stringify(Alpine.store('auth').user || {}));
        },

        // --- EDIT MODE FUNCTIONS ---
        startEditing() {
            // Clone the current user data into the form data to avoid changing the display while typing
            this.formData = JSON.parse(JSON.stringify(this.user));
            // Ensure areas_of_interest is an array
            if (!this.formData.areas_of_interest) {
                this.formData.areas_of_interest = [];
            }
            this.isEditing = true;
        },

        cancelEdit() {
            this.isEditing = false;
            this.formData = {}; // Discard changes
        },

        async saveProfile() {
            this.saveLoading = true; this.saveMessage = ''; this.saveError = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.put('/api/users/profile', this.formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                // Update the global store with the new, complete user object from the server
                Alpine.store('auth').updateUser(response.data.user);
                this.saveMessage = response.data.message;
                this.saveError = false;
                this.isEditing = false; // Exit edit mode on success
            } catch (err) {
                this.saveMessage = err.response ? err.response.data.message : 'An error occurred.';
                this.saveError = true;
            } finally {
                this.saveLoading = false;
            }
        },

        // --- TAG/INTEREST HANDLING (for the form) ---
        addInterest() {
            const newInterest = this.interestInput.trim();
            if (newInterest && !this.formData.areas_of_interest.includes(newInterest)) {
                this.formData.areas_of_interest.push(newInterest);
            }
            this.interestInput = '';
        },

        removeInterest(index) {
            this.formData.areas_of_interest.splice(index, 1);
        },

        linkWithKingsChat() {
            this.kcMessage = ''; this.kcError = false;
            const loginOptions = {
                scopes: ["profile"],
                clientId: 'b2b522e9-d602-402d-b61d-8a50825862da'
            };

            window.kingsChatWebSdk.login(loginOptions)
                .then(response => {
                    const accessToken = response.accessToken;
                    if (accessToken) {
                        this.sendTokenToBackend(accessToken);
                    } else {
                        throw new Error("Access Token not found in SDK response!");
                    }
                })
                .catch(error => {
                    console.error('KingsChat SDK login error:', error);
                    this.kcMessage = 'KingsChat login failed or was cancelled.';
                    this.kcError = true;
                });
        },

        async sendTokenToBackend(accessToken) {
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/kingschat/link', { accessToken }, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                Alpine.store('auth').updateUser(response.data.user);
                this.user = response.data.user;
                this.kcMessage = response.data.message;
                this.kcError = false;
            } catch (error) {
                console.error('Backend linking error:', error.response ? error.response.data : error);
                this.kcMessage = error.response ? error.response.data.message : 'A server error occurred.';
                this.kcError = true;
            }
        },

        async applyToBeSbo() {
            this.sboApplyLoading = true;
            this.sboApplyMessage = '';
            this.sboApplyError = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/sbo/apply', this.sboFormData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.sboApplyMessage = response.data.message;
                // You might want to update the user object or page state here
            } catch (err) {
                this.sboApplyMessage = err.response?.data?.message || 'Application failed.';
                this.sboApplyError = true;
            } finally {
                this.sboApplyLoading = false;
            }
        }

    }));

    //================================================================
    // 4. BUSINESS PAGE FORM COMPONENT
    //================================================================
    Alpine.data('businessForm', () => ({
        formData: {
            regNumber: '',
            name: '',
            location: ''
        },
        message: '',
        error: false,
        loading: false,

        async handleSubmit() {
            this.loading = true;
            this.message = '';
            this.error = false;

            // Check 1: Is the user logged in at all?
            if (!Alpine.store('auth').loggedIn || !Alpine.store('auth').token) {
                this.message = 'You must be logged in to submit an inquiry. Please open the login modal.';
                this.error = true;
                this.loading = false;
                // You can programmatically open the modal for the user
                const signInModal = new bootstrap.Modal(document.getElementById('signInUpModal'));
                signInModal.show();
                return;
            }

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/business/inquire', this.formData, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                this.message = response.data.message;
                this.error = false;
                this.formData = { regNumber: '', name: '', location: '' };

            } catch (error) {
                // Check 2: Did the request fail specifically because the token expired (403 Forbidden)?
                if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                    this.message = 'Your session has expired. Please log in again to submit the form.';
                    this.error = true;
                    // Force a logout to clear the bad token and prompt for a fresh login
                    Alpine.store('auth').logout();
                    // Open the modal
                    const signInModal = new bootstrap.Modal(document.getElementById('signInUpModal'));
                    signInModal.show();
                } else {
                    // Handle other server errors
                    this.message = error.response ? error.response.data.message : 'An error occurred.';
                    this.error = true;
                }
            } finally {
                this.loading = false;
            }
        }
    }));

    //================================================================
    // 5. JOB BOARD COMPONENT (placements.html)
    //================================================================
    Alpine.data('jobBoard', () => ({
        jobs: [],
        currentPage: 1,
        totalPages: 1,
        searchTerm: '',
        loading: true,
        error: '',

        init() {
            // Automatically fetch jobs when the component is initialized
            this.fetchJobs(1);
        },

        async fetchJobs(page) {
            if (page < 1 || page > this.totalPages && this.totalPages > 0) {
                return; // Don't fetch if page is out of bounds
            }
            this.loading = true;
            this.error = '';
            try {
                // Construct the API URL with query parameters
                const params = new URLSearchParams({
                    page: page,
                    limit: 10, // Show 10 jobs per page
                    search: this.searchTerm
                });

                const response = await axios.get(`/api/jobs?${params.toString()}`);

                this.jobs = response.data.jobs;
                this.currentPage = response.data.currentPage;
                this.totalPages = response.data.totalPages;

            } catch (err) {
                this.error = 'Failed to load job listings. Please try again later.';
                console.error('Fetch jobs error:', err);
            } finally {
                this.loading = false;
            }
        },

        searchJobs() {
            // When a new search is performed, always reset to page 1
            this.fetchJobs(1);
        }
    }));

    //================================================================
    // 6. JOB DETAIL COMPONENT (job-detail.html)
    //================================================================
    Alpine.data('jobDetail', () => ({
        job: {},
        jobId: null,
        loading: true,
        error: '',

        // Application state
        hasApplied: false,
        applyLoading: false,
        applyMessage: '',
        applyError: false,

        init() {
            // Get the job ID from the URL query parameter
            const params = new URLSearchParams(window.location.search);
            this.jobId = params.get('id');

            if (this.jobId) {
                this.fetchJobDetails();
                // If user is logged in, check if they've already applied
                if (Alpine.store('auth').loggedIn) {
                    this.checkApplicationStatus();
                }
            } else {
                this.error = 'No job ID provided.';
                this.loading = false;
            }
        },

        async fetchJobDetails() {
            this.loading = true;
            this.error = '';
            try {
                const response = await axios.get(`/api/jobs/${this.jobId}`);
                this.job = response.data;
            } catch (err) {
                this.error = 'Failed to load job details. The position may no longer be available.';
                console.error('Fetch job detail error:', err);
            } finally {
                this.loading = false;
            }
        },

        async checkApplicationStatus() {
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get(`/api/jobs/${this.jobId}/check-application`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.hasApplied = response.data.hasApplied;
            } catch (err) {
                console.error('Error checking application status:', err);
            }
        },

        async applyForJob() {
            if (this.hasApplied) return;
            this.applyLoading = true;
            this.applyMessage = '';
            this.applyError = false;

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post(`/api/jobs/${this.jobId}/apply`, {}, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                this.applyMessage = response.data.message;
                this.applyError = false;
                this.hasApplied = true; // Mark as applied on success

            } catch (err) {
                this.applyMessage = err.response ? err.response.data.message : 'An error occurred.';
                this.applyError = true;
            } finally {
                this.applyLoading = false;
            }
        }
    }));

    //================================================================
    // 7. MANAGE JOBS COMPONENT (manage-jobs.html)
    //================================================================
    Alpine.data('manageJobs', () => ({
        jobs: [],
        loading: true,
        message: '',
        error: false,

        init() {
            this.fetchMyJobs();
        },

        async fetchMyJobs() {
            this.loading = true;
            this.message = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get('/api/jobs/my-jobs', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.jobs = response.data;
            } catch (err) {
                this.message = 'Failed to load your job posts.';
                this.error = true;
                console.error('Fetch my jobs error:', err);
            } finally {
                this.loading = false;
            }
        },

        async deleteJob(jobId) {
            // Ask for confirmation before deleting
            if (!confirm('Are you sure you want to permanently delete this job post?')) {
                return;
            }

            this.message = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.delete(`/api/jobs/${jobId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                // Remove the job from the local array to update the UI instantly
                this.jobs = this.jobs.filter(job => job.id !== jobId);
                this.message = response.data.message;
                this.error = false;
            } catch (err) {
                this.message = err.response ? err.response.data.message : 'Failed to delete job post.';
                this.error = true;
                console.error('Delete job error:', err);
            }
        }
    }));

    //================================================================
    // 8. ADMIN DASHBOARD COMPONENT (admin-dashboard.html)
    //================================================================
    Alpine.data('adminDashboard', () => ({
        users: [],
        loading: true,
        message: '',
        error: false,

        // NEW state for search and pagination
        searchTerm: '',
        currentPage: 1,
        totalPages: 1,

        init() {
            this.fetchAllUsers(1); // Fetch the first page on init
        },

        // UPDATED fetch function to handle pages and search
        async fetchAllUsers(page = 1) {
            if (page < 1 || (page > this.totalPages && this.totalPages > 0)) return;
            this.loading = true;
            try {
                const token = Alpine.store('auth').token;
                const params = new URLSearchParams({
                    page: page,
                    search: this.searchTerm
                });
                const response = await axios.get(`/api/users?${params.toString()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.users = response.data.users;
                this.currentPage = response.data.currentPage;
                this.totalPages = response.data.totalPages;
            } catch (err) {
                this.message = 'Failed to load users.';
                this.error = true;
                console.error('Fetch all users error:', err);
            } finally {
                this.loading = false;
            }
        },

        // NEW search handler
        searchUsers() {
            this.fetchAllUsers(1); // Always reset to page 1 for a new search
        },

        // changeRole function is unchanged
        async changeRole(userId, newRole) {
            if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
                return;
            }
            this.message = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.put(`/api/users/${userId}/role`, { newRole }, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                // Update the user's role in the local list
                const userIndex = this.users.findIndex(u => u.id === userId);
                if (userIndex !== -1) {
                    this.users[userIndex].role = newRole;
                }
                this.message = response.data.message;
                this.error = false;
            } catch (err) {
                this.message = err.response ? err.response.data.message : 'Failed to update user role.';
                this.error = true;
                console.error('Change role error:', err);
            }
        }
    }));

    //================================================================
    // 9. CREATE JOB FORM COMPONENT (create-job.html)
    //================================================================
    Alpine.data('createJobForm', () => ({
        formData: {
            title: '',
            description: '',
            tags: []
        },
        tagInput: '',
        message: '',
        error: false,
        loading: false,

        // Adds the text from the input field to the tags array
        addTag() {
            const newTag = this.tagInput.trim();
            if (newTag && !this.formData.tags.includes(newTag)) {
                this.formData.tags.push(newTag);
            }
            this.tagInput = ''; // Clear the input field
        },

        // Removes a tag when it's clicked
        removeTag(index) {
            this.formData.tags.splice(index, 1);
        },

        async handleSubmit() {
            this.loading = true;
            this.message = '';
            this.error = false;

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/jobs', this.formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                this.message = 'Job post created successfully! Redirecting...';
                this.error = false;

                // Redirect to the management page after a short delay
                setTimeout(() => {
                    window.location.href = '/manage-jobs.html';
                }, 1500);

            } catch (err) {
                this.message = err.response ? err.response.data.message : 'Failed to create job post.';
                this.error = true;
                this.loading = false;
                console.error('Create job error:', err);
            }
        }
    }));

    //================================================================
    // 10. EDIT JOB FORM COMPONENT (edit-job.html)
    //================================================================
    Alpine.data('editJobForm', () => ({
        jobId: null,
        formData: {
            title: '',
            description: '',
            tags: [],
            is_active: true
        },
        tagInput: '',
        loading: true, // For initial data fetch
        fetchError: '',
        submitLoading: false, // For form submission
        submitMessage: '',
        submitError: false,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.jobId = params.get('id');
            if (this.jobId) {
                this.fetchJobData();
            } else {
                this.fetchError = 'No job ID specified.';
                this.loading = false;
            }
        },

        async fetchJobData() {
            this.loading = true;
            this.fetchError = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get(`/api/jobs/edit/${this.jobId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                // Populate formData with the fetched job data
                this.formData = response.data;
                // Ensure tags is an array, as the DB might return null if it's empty
                if (!this.formData.tags) {
                    this.formData.tags = [];
                }
            } catch (err) {
                this.fetchError = err.response ? err.response.data.message : 'Failed to load job data.';
                console.error('Fetch job data error:', err);
            } finally {
                this.loading = false;
            }
        },

        // Tag handling is the same as the create form
        addTag() {
            const newTag = this.tagInput.trim();
            if (newTag && !this.formData.tags.includes(newTag)) {
                this.formData.tags.push(newTag);
            }
            this.tagInput = '';
        },
        removeTag(index) {
            this.formData.tags.splice(index, 1);
        },

        async handleSubmit() {
            this.submitLoading = true;
            this.submitMessage = '';
            this.submitError = false;

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.put(`/api/jobs/${this.jobId}`, this.formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                this.submitMessage = response.data.message + ' Redirecting...';
                this.submitError = false;

                setTimeout(() => {
                    window.location.href = '/manage-jobs.html';
                }, 1500);

            } catch (err) {
                this.submitMessage = err.response ? err.response.data.message : 'Failed to update job post.';
                this.submitError = true;
                this.submitLoading = false;
                console.error('Update job error:', err);
            }
        }
    }));

    //================================================================
    // 11. JOB APPLICANTS COMPONENT (job-applicants.html)
    //================================================================
    Alpine.data('jobApplicants', () => ({
        jobId: null,
        jobTitle: '',
        applicants: [],
        loading: true,
        error: '',
        selectedUser: {},
        userLoading: false,
        userProfileModal: null,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.jobId = params.get('jobId');
            this.jobTitle = decodeURIComponent(params.get('jobTitle') || '');

            if (this.jobId) {
                this.fetchApplicants();
            } else {
                this.error = 'No job ID specified.';
                this.loading = false;
            }

            // --- THIS IS THE CRITICAL FIX ---
            // Find the modal element and create a Bootstrap Modal instance
            this.$nextTick(() => {
                const modalEl = document.getElementById('userProfileModal');
                if (modalEl) {
                    this.userProfileModal = new bootstrap.Modal(modalEl);
                }
            });
        },

        async fetchApplicants() {
            this.loading = true;
            this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get(`/api/jobs/${this.jobId}/applicants`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.applicants = response.data;
            } catch (err) {
                this.error = err.response ? err.response.data.message : 'Failed to load applicants.';
                console.error('Fetch applicants error:', err);
            } finally {
                this.loading = false;
            }
        },

        async viewUserProfile(userId) {
            if (!this.userProfileModal) return; // Safety check
            this.userLoading = true;
            this.userProfileModal.show();
            try {
                const token = Alpine.store('auth').token;
                const res = await axios.get(`/api/admin/users/${userId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.selectedUser = res.data;
            } catch (err) {
                console.error(err);
                // Optionally, show an error inside the modal
            } finally {
                this.userLoading = false;
            }
        }
    }));

    //================================================================
    // 12. PLACEMENTS APPLICATION FORM COMPONENT
    //================================================================
    Alpine.data('applicationForm', () => ({
        formData: {
            zone: '', group: '', church: '', leadership_role: '', ministry_staff: null,
            ministry_department: '', educational_qualification: '', institution_of_completion: '',
            professional_qualification: '', has_work_experience: null, organisation_of_employment: '',
            duration_of_employment: '', significant_achievements: '',
            areas_of_interest: [], // <-- CHANGED to an array
            apply_for: ''
        },
        interestInput: '', // <-- NEW property for the input field
        message: '',
        error: false,
        loading: false,

        init() {
            this.$watch('$store.auth.user', (newUser) => { if (newUser) { this.prefillForm(newUser); } });
            if (Alpine.store('auth').user) { this.prefillForm(Alpine.store('auth').user); }
        },
        prefillForm(user) {
            for (const key in this.formData) {
                if (user[key] !== null && user[key] !== undefined) {
                    // Ensure areas_of_interest is always an array
                    if (key === 'areas_of_interest' && !Array.isArray(user[key])) {
                        this.formData[key] = [];
                    } else {
                        this.formData[key] = user[key];
                    }
                }
            }
        },

        // --- NEW TAG/INTEREST HANDLING LOGIC ---
        addInterest() {
            const newInterest = this.interestInput.trim();
            if (newInterest && !this.formData.areas_of_interest.includes(newInterest)) {
                this.formData.areas_of_interest.push(newInterest);
            }
            this.interestInput = ''; // Clear the input
        },
        removeInterest(index) {
            this.formData.areas_of_interest.splice(index, 1);
        },
        // ------------------------------------

        async handleSubmit() {
            this.loading = true; this.message = ''; this.error = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.put('/api/users/profile', this.formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                Alpine.store('auth').updateUser(response.data.user);
                this.message = response.data.message;
                this.error = false;

                // Wait a moment for the user to see the success message
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Return true to signal success to the parent component
                return true;

            } catch (err) {
                this.message = err.response ? err.response.data.message : 'An error occurred.';
                this.error = true;
                return false; // Signal failure
            } finally {
                this.loading = false;
            }
        }
    }));


    //================================================================
    // 13. INNOVATE FORM COMPONENT (innovate.html)
    //================================================================
    Alpine.data('innovateForm', () => ({
        description: '',
        files: [],
        message: '',
        error: false,
        loading: false,

        addFilesToList(event) {
            // Add the newly selected files to our existing files array
            this.files.push(...Array.from(event.target.files));
            // Clear the input so the user can select more
            event.target.value = null;
        },
        // NEW function to remove a file
        removeFile(index) {
            this.files.splice(index, 1);
        },

        async handleSubmit() {
            this.loading = true;
            this.message = '';
            this.error = false;

            // FormData is required for sending files
            const formData = new FormData();
            formData.append('description', this.description);

            // Append each file to the FormData object with the same key 'files'
            this.files.forEach(file => {
                formData.append('files', file);
            });

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/innovate/submit', formData, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data' // Axios needs this header for FormData
                    }
                });

                this.message = response.data.message;
                this.error = false;
                // Reset form on success
                this.description = '';
                this.files = [];
                document.getElementById('files').value = null; // Clear file input

            } catch (err) {
                this.message = err.response ? err.response.data.message : 'An error occurred.';
                this.error = true;
            } finally {
                this.loading = false;
            }
        }
    }));

    //================================================================
    // 14. E-COMMERCE SHOP PAGE COMPONENT (shop.html)
    //================================================================
    Alpine.data('shopPage', () => ({
        slides: [],
        bestsellers: [], // NEW: A dedicated array for bestsellers
        sections: [],
        featuredSectors: [],
        loading: true,
        showSearch: false,
        formatPrice: formatPrice,

        async init() {
            this.loading = true;
            try {
                // THE FIX: Fetch all four data sources in parallel
                const [slidesRes, bestsellersRes, sectionsRes, featuredSectorsRes] = await Promise.all([
                    axios.get('/api/content/hero-slides'),
                    axios.get('/api/content/weekly-bestsellers'),
                    axios.get('/api/content/shop-sections'),
                    axios.get('/api/content/featured-sectors')
                ]);

                // Store ALL the data correctly
                this.slides = slidesRes.data;
                this.bestsellers = bestsellersRes.data;
                this.sections = sectionsRes.data;
                this.featuredSectors = featuredSectorsRes.data;
                window.addEventListener('content-updated', () => {
                    console.log('Content updated event received. Re-fetching shop data.');
                    this.fetchPageContent();
                });
            } catch (error) {
                console.error("Failed to load shop content:", error);
            } finally {
                this.loading = false;
            }
        },

        // A single function to fetch all necessary data
        async fetchPageContent() {
            this.loading = true;

            // Use Promise.all to fetch everything in parallel for speed
            try {
                const [slidesRes, bestsellersRes, sectionsRes] = await Promise.all([
                    axios.get('/api/content/hero-slides'),
                    axios.get('/api/content/weekly-bestsellers'),
                    axios.get('/api/content/shop-sections')
                ]);

                this.slides = slidesRes.data;
                this.bestsellers = bestsellersRes.data;
                this.sections = sectionsRes.data;

            } catch (error) {
                console.error("Failed to load shop content:", error);
            } finally {
                this.loading = false;
            }
        },

        scrollCarousel(element, distance) {
            element.scrollBy({ left: distance, behavior: 'smooth' });
        }
    }));

    //================================================================
    // 15. PRODUCT DETAIL PAGE COMPONENT (product-detail.html)
    //================================================================
    Alpine.data('productDetailPage', () => ({
        product: {},
        productId: null,
        activeImageUrl: '',
        quantity: 1,
        loading: true,
        error: '',
        cartMessage: '',
        cartError: false,
        showSearch: false,
        formatPrice: formatPrice,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.productId = params.get('id');
            if (this.productId) this.fetchProductDetails();
            else {
                this.error = 'No product ID specified.';
                this.loading = false;
            }
        },

        async fetchProductDetails() {
            this.loading = true; this.error = '';
            try {
                const response = await axios.get(`/api/products/${this.productId}`);
                this.product = response.data;
                if (this.product.images?.length > 0)
                    this.activeImageUrl = this.product.images[0].image_url;
            } catch (err) {
                this.error = 'Failed to load product details.';
                console.error('Fetch product error:', err);
            } finally {
                this.loading = false;
            }
        },

        incrementQuantity() {
            const maxQuantity = this.product.stock_quantity;
            // Only increment if backorder is allowed OR if quantity is less than stock
            if (this.product.allow_backorder || this.quantity < maxQuantity) {
                this.quantity++;
            }
        },
        decrementQuantity() {
            if (this.quantity > 1) {
                this.quantity--;
            }
        },

        async addToCart() {
            this.cartMessage = 'Adding...';
            this.cartError = false;
            const result = await Alpine.store('cart').addItem(this.productId, this.quantity);
            this.cartMessage = result.message;
            this.cartError = !result.success;
            setTimeout(() => {
                this.cartMessage = '';
            }, 3000);
        },

        toggleSearch() {
            this.showSearch = !this.showSearch;
        }
    }));

    //================================================================
    // 16. GLOBAL CART STORE
    //================================================================
    Alpine.store('cart', {
        items: [],
        itemCount: 0,

        // This function is now the single point of truth for updating the local state
        _updateState(cartItems) {
            this.items = cartItems;
            this.itemCount = this.items.reduce((total, item) => total + item.quantity, 0);
            console.log('Cart state updated. Item count:', this.itemCount);
        },

        async initialize() {
            if (Alpine.store('auth').loggedIn) {
                try {
                    const token = Alpine.store('auth').token;
                    const response = await axios.get('/api/cart', { headers: { 'Authorization': `Bearer ${token}` } });
                    this._updateState(response.data); // Use the new state updater
                } catch (error) {
                    console.error('Failed to initialize cart:', error);
                    this._updateState([]); // Clear cart on error
                }
            } else {
                this._updateState([]); // Clear cart if logged out
            }
        },

        async addItem(productId, quantity) {
            if (!Alpine.store('auth').loggedIn) {
                new bootstrap.Modal(document.getElementById('signInUpModal')).show();
                return { success: false, message: 'Please log in to add items to your cart.' };
            }
            try {
                const token = Alpine.store('auth').token;
                // The POST returns the new cart state, let's use it
                const response = await axios.post('/api/cart/items', { productId, quantity }, { headers: { 'Authorization': `Bearer ${token}` } });
                await this.initialize(); // Re-fetch the whole cart for consistency
                return { success: true, message: 'Item added to cart!' };
            } catch (error) {
                console.error('Failed to add item to cart:', error);
                return { success: false, message: 'Could not add item to cart.' };
            }
        },

        async updateItem(productId, quantity) {
            if (quantity < 1) return this.removeItem(productId);
            try {
                const token = Alpine.store('auth').token;
                await axios.put(`/api/cart/items/${productId}`, { quantity }, { headers: { 'Authorization': `Bearer ${token}` } });
                await this.initialize();
            } catch (error) { console.error('Failed to update item:', error); }
        },

        async removeItem(productId) {
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/cart/items/${productId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                await this.initialize();
            } catch (error) { console.error('Failed to remove item:', error); }
        }
    });


    // ===============================================================
    // 17. CART PAGE COMPONENT
    // ===============================================================
    Alpine.data('cartPage', () => ({
        checkoutError: '',
        isCheckingOut: false,
        debounce: null,
        showSearch: false,
        formatPrice: formatPrice,

        subtotal() {
            // THE FIX: Use 'active_price', which now correctly exists on the item object
            const totalInUSD = Alpine.store('cart').items.reduce((total, item) => {
                // Add a check to ensure active_price is a number
                const price = typeof item.active_price === 'number' ? item.active_price : 0;
                return total + (price * item.quantity);
            }, 0);
            return this.formatPrice(totalInUSD);
        },

        updateQuantity(productId, quantity) {
            clearTimeout(this.debounce);
            this.debounce = setTimeout(() => {
                Alpine.store('cart').updateItem(productId, parseInt(quantity));
            }, 500);
        },

        removeItem(productId) {
            if (confirm('Remove this item?'))
                Alpine.store('cart').removeItem(productId);
        },

        async proceedToCheckout() {
            this.isCheckingOut = true; this.checkoutError = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/checkout/create-session', {}, { headers: { 'Authorization': `Bearer ${token}` } });
                window.location.href = response.data.url;
            } catch (error) {
                this.checkoutError = error.response ? error.response.data.message : 'Checkout failed.';
                this.isCheckingOut = false;
            }
        },

        toggleSearch() {
            this.showSearch = !this.showSearch;
        }
    }));

    // ===============================================================
    // 18. Sector Page
    // ===============================================================
    Alpine.data('sectorPage', () => ({
        sector: {}, // Holds info like name and hero_image_url

        // Create separate arrays for each section's data
        bestsellers: [],
        newArrivals: [],

        // Data specifically for the Food & Beverage layout
        familyFeasts: [],
        fruitsAndVeg: [],


        otherProducts: [], // For the 'Order Now' carousel

        showSearch: false,

        loading: true,
        error: '',

        formatPrice: formatPrice,

        init() {
            const params = new URLSearchParams(window.location.search);
            const sectorName = params.get('name');
            if (sectorName) {
                this.fetchSectorData(sectorName);
            } else {
                this.error = 'No sector specified.';
                this.loading = false;
            }
        },

        async fetchSectorData(sectorName) {
            this.loading = true;
            this.error = '';
            try {
                // Step 1: Always get the main sector details first
                const sectorRes = await axios.get(`/api/products/sector/${sectorName}`);
                this.sector = sectorRes.data.sector;
                const sectorId = this.sector.id;

                // Step 2: CONDITIONAL DATA FETCHING
                if (sectorName === 'Food & Beverage') {
                    // --- Food & Beverage Layout ---
                    const [feastsRes, fruitsRes] = await Promise.all([
                        axios.get(`/api/products/sector/${sectorId}/family-feasts`),
                        axios.get(`/api/products/sector/${sectorId}/fruits-vegetables`)
                    ]);
                    this.familyFeasts = feastsRes.data;
                    this.fruitsAndVeg = fruitsRes.data;
                } else {
                    // --- Default Layout ---
                    const [bestsellersRes, newArrivalsRes] = await Promise.all([
                        axios.get(`/api/products/sector/${sectorId}/bestsellers`),
                        axios.get(`/api/products/sector/${sectorId}/new-arrivals`)
                    ]);
                    this.bestsellers = bestsellersRes.data;
                    this.newArrivals = newArrivalsRes.data;
                }

                // The 'Order Now' data can be the generic product list for now
                this.otherProducts = sectorRes.data.products;

            } catch (err) {
                console.error('Error loading sector page data:', err);
                this.error = 'Could not load this sector\'s content.';
            } finally {
                this.loading = false;
            }
        },

        scrollCarousel(element, distance) {
            if (element) {
                element.scrollBy({ left: distance, behavior: 'smooth' });
            }
        },

        toggleSearch() {
            this.showSearch = !this.showSearch;
        }

    }));

    // public/js/main.js
    Alpine.data('searchPage', () => ({
        products: [],
        searchTerm: '',
        loading: true,
        showSearch: false,
        formatPrice: formatPrice,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.searchTerm = params.get('q');
            if (this.searchTerm) this.fetchResults();
            else this.loading = false;
        },
        async fetchResults() {
            this.loading = true;
            try {
                const response = await axios.get(`/api/products?q=${this.searchTerm}`);
                this.products = response.data;
            } catch (err) { console.error(err); }
            finally { this.loading = false; }
        },

        toggleSearch() {
            this.showSearch = !this.showSearch;
        }

    }));

    //================================================================
    // 19. ORDER HISTORY PAGE COMPONENT
    //================================================================
    Alpine.data('orderHistoryPage', () => ({
        orders: [],
        loading: true,
        error: '',

        // New state for search and pagination
        searchTerm: '',
        currentPage: 1,
        totalPages: 1,
        formatPrice: formatPrice,

        init() {
            // Watch for login/logout to fetch orders automatically
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn) this.fetchOrders(); else this.orders = [];
            });
            if (Alpine.store('auth').loggedIn) this.fetchOrders(); else this.loading = false;

            // Add event listener for when an accordion item is shown
            const accordion = this.$root.querySelector('#orderAccordion');
            if (accordion) {
                accordion.addEventListener('show.bs.collapse', event => {
                    const orderId = event.target.id.split('-')[1];
                    this.fetchOrderDetails(orderId);
                });
            }
        },

        async fetchOrders(page = 1) {
            if (page < 1 || (page > this.totalPages && this.totalPages > 0)) return;
            this.loading = true; this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const params = new URLSearchParams({
                    page: page,
                    limit: 10,
                    search: this.searchTerm
                });
                const response = await axios.get(`/api/orders/my-orders?${params.toString()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.orders = response.data.orders.map(o => ({ ...o, items: null, itemsLoading: false }));
                this.currentPage = response.data.currentPage;
                this.totalPages = response.data.totalPages;
            } catch (err) {
                this.error = 'Failed to load order history.';
            } finally { this.loading = false; }
        },

        // New search handler
        searchOrders() {
            this.fetchOrders(1); // Always reset to page 1 for a new search
        },

        async fetchOrderDetails(orderId) {
            const orderIndex = this.orders.findIndex(o => o.id == orderId);
            if (orderIndex === -1 || this.orders[orderIndex].items) return; // Already loaded

            this.orders[orderIndex].itemsLoading = true;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get(`/api/orders/${orderId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.orders[orderIndex].items = response.data.items;
            } catch (err) {
                console.error('Failed to load order details:', err);
            } finally {
                this.orders[orderIndex].itemsLoading = false;
            }
        }
    }));

    // 20. --- ADD THESE NEW ADMIN COMPONENTS ---
    Alpine.data('adminProductsPage', () => ({
        products: [],
        loading: true,
        formatPrice: formatPrice,
        currentPage: 1,
        totalPages: 1,
        message: '',
        error: false,

        init() {
            if (Alpine.store('auth').loggedIn) {
                this.fetchProducts(1); // Fetch the first page on init
            } else {
                this.loading = false;
            }
        },

        // Update the fetch function to handle pages
        async fetchProducts(page = 1) {
            if (page < 1 || (page > this.totalPages && this.totalPages > 0)) return;
            this.loading = true;
            try {
                const token = Alpine.store('auth').token;
                const params = new URLSearchParams({ page });
                const response = await axios.get(`/api/admin/products?${params.toString()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.products = response.data.products;
                this.currentPage = response.data.currentPage;
                this.totalPages = response.data.totalPages;
            } catch (err) {
                console.error(err);
            } finally {
                this.loading = false;
            }
        },
        async deleteProduct(productId) {
            if (!confirm('Are you sure you want to permanently delete this product and all its images? This action cannot be undone.')) {
                return;
            }

            this.message = ''; this.error = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.delete(`/api/admin/products/${productId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                // Remove the product from the local list for an instant UI update
                this.products = this.products.filter(p => p.id !== productId);

                this.message = response.data.message;
                this.error = false;
            } catch (err) {
                this.message = err.response?.data?.message || 'Failed to delete product.';
                this.error = true;
                console.error('Delete product error:', err);
            }
        }
    }));

    // 21
    Alpine.data('adminCreateProductPage', () => ({
        formData: {
            name: '', description: '', price: 0, stock_quantity: 0, sector_id: '', brand_id: '',
            sbo_profile_id: ''
        },

        files: [],
        imagePreviews: [],
        sectors: [],
        brands: [],
        message: '',
        error: false,
        loading: false,
        sboProfiles: [], // Add new array

        init() {
            this.fetchInitialData();
            this.$nextTick(() => {
                const user = Alpine.store('auth').user;
                // If the logged-in user is an SBO and has a profile ID, auto-select it.
                if (user && user.role === 'SBO' && user.sbo_profile_id) {
                    this.formData.sbo_profile_id = user.sbo_profile_id;
                }
            });
        },

        async fetchInitialData() {
            try {
                const token = Alpine.store('auth').token;
                const headers = { 'Authorization': `Bearer ${token}` };
                const [sectorsRes, brandsRes, sboProfilesRes] = await Promise.all([
                    axios.get('/api/products/sectors'),
                    axios.get('/api/products/brands'),
                    axios.get('/api/admin/sbo-profiles', { headers }) // Fetch SBOs
                ]);
                this.sectors = sectorsRes.data;
                this.brands = brandsRes.data;
                this.sboProfiles = sboProfilesRes.data;
            } catch (err) {
                console.error('Failed to fetch sectors/brands', err);
            }
        },
        handleFileSelect(event) {
            this.files = Array.from(event.target.files);
            this.imagePreviews = [];
            for (const file of this.files) {
                this.imagePreviews.push(URL.createObjectURL(file));
            }
        },
        async handleSubmit() {
            this.loading = true; this.message = ''; this.error = false;
            const data = new FormData();
            for (const key in this.formData) { data.append(key, this.formData[key]); }
            for (const file of this.files) { data.append('images', file); }

            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/admin/products', data, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } });
                this.message = response.data.message + ' Redirecting...';
                setTimeout(() => window.location.href = '/admin-products.html', 1500);
            } catch (err) {
                this.message = err.response?.data?.message || 'Failed to create product.';
                this.error = true; this.loading = false;
            }
        }
    }));

    // 22
    Alpine.data('adminEditProductPage', () => ({
        productId: null,
        formData: {},
        currentImages: [], // For displaying existing images
        newFiles: [], // For staging new uploads
        sectors: [],
        brands: [],
        loading: true,
        fetchError: '',
        submitLoading: false,
        submitMessage: '',
        submitError: false,
        sboProfiles: [], // Add new array


        // Helper getters/setters to handle date formatting for the input[type=date]
        get sale_start_date_formatted() {
            return this.formData.sale_start_date ? new Date(this.formData.sale_start_date).toISOString().split('T')[0] : '';
        },
        set sale_start_date_formatted(value) { this.formData.sale_start_date = value; },
        get sale_end_date_formatted() {
            return this.formData.sale_end_date ? new Date(this.formData.sale_end_date).toISOString().split('T')[0] : '';
        },
        set sale_end_date_formatted(value) { this.formData.sale_end_date = value; },

        init() {
            const params = new URLSearchParams(window.location.search);
            this.productId = params.get('id');
            if (this.productId) {
                this.fetchInitialData();
            } else {
                this.fetchError = 'No product ID provided.'; this.loading = false;
            };
            this.$nextTick(() => {
                const user = Alpine.store('auth').user;
                // If the logged-in user is an SBO and has a profile ID, auto-select it.
                if (user && user.role === 'SBO' && user.sbo_profile_id) {
                    this.formData.sbo_profile_id = user.sbo_profile_id;
                }
            });
        },

        async fetchInitialData() {
            this.loading = true;
            this.fetchError = '';
            try {
                const token = Alpine.store('auth').token;
                const headers = { 'Authorization': `Bearer ${token}` };

                // THE FIX: Add the missing axios call for '/api/admin/sbo-profiles'
                const [productRes, imagesRes, sectorsRes, brandsRes, sboProfilesRes] = await Promise.all([
                    axios.get(`/api/admin/products/${this.productId}`, { headers }),
                    axios.get(`/api/admin/products/${this.productId}/images`, { headers }),

                    // These don't require auth, but it doesn't hurt to send the header
                    axios.get('/api/products/sectors'),
                    axios.get('/api/products/brands'),

                    // THIS WAS THE MISSING API CALL
                    axios.get('/api/admin/sbo-profiles', { headers })
                ]);

                this.formData = productRes.data;
                this.currentImages = imagesRes.data;
                this.sectors = sectorsRes.data;
                this.brands = brandsRes.data;

                // This line will now work because sboProfilesRes exists
                this.sboProfiles = sboProfilesRes.data;

            } catch (err) {
                this.fetchError = err.response?.data?.message || 'Failed to load product data for editing.';
                console.error('Fetch edit data error:', err);
            } finally {
                this.loading = false;
            }
        },

        handleFileSelect(event) {
            this.newFiles = Array.from(event.target.files);
        },

        async deleteImage(imageId) {
            if (!confirm('Are you sure you want to delete this image?')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/images/${imageId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                // Remove the image from the local list instantly
                this.currentImages = this.currentImages.filter(img => img.id !== imageId);
            } catch (err) {
                alert('Failed to delete image.');
                console.error(err);
            }
        },

        async handleSubmit() {
            this.submitLoading = true; this.submitMessage = ''; this.submitError = false;

            // 1. Create a FormData object to hold everything
            const data = new FormData();

            // 2. Append all the text/numeric data from the form
            for (const key in this.formData) {
                // Handle null/undefined values correctly
                const value = this.formData[key];
                if (value !== null && value !== undefined) {
                    data.append(key, value);
                }
            }

            // 3. Append any NEW files the user has selected
            for (const file of this.newFiles) {
                data.append('newImages', file);
            }

            try {
                const token = Alpine.store('auth').token;

                // 4. Send a single POST request to our new endpoint
                const response = await axios.post(`/api/admin/products/${this.productId}/update`, data, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data' // Crucial for sending files
                    }
                });

                this.submitMessage = response.data.message + ' Redirecting...';
                setTimeout(() => window.location.href = '/admin-products.html', 1500);

            } catch (err) {
                this.submitMessage = err.response?.data?.message || 'Failed to save changes.';
                this.submitError = true;
            } finally {
                this.submitLoading = false;
            }
        }
    }));

    // 23
    Alpine.data('adminCategoriesPage', () => ({
        sectors: [],
        brands: [],
        loading: true,

        // State for the 'Add Sector' form
        newSector: {
            name: '',
            image_url_file: null,
            hero_image_url_file: null,
            is_featured: false
        },

        sectorMessage: '',
        sectorError: false,
        sectorFormLoading: false,
        // State for the 'Add Brand' form
        newBrandName: '',
        brandMessage: '',
        brandError: false,
        brandFormLoading: false,

        init() {
            // THE FIX: Use the hasRole() helper to check for permissions.
            // This will correctly return 'true' for both Admins and Superadmins.
            if (Alpine.store('auth').hasRole('Admin')) {
                this.fetchCategories();
            } else {
                // Also good practice to stop the loading spinner if the user is not authorized.
                this.loading = false;
            }

            // We can also add a watcher for robustness, in case the user logs in on this page.
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn && Alpine.store('auth').hasRole('Admin')) {
                    this.fetchCategories();
                }
            });
        },

        async fetchCategories() {
            this.loading = true;
            try {
                const [sectorsRes, brandsRes] = await Promise.all([
                    axios.get('/api/products/sectors'),
                    axios.get('/api/products/brands')
                ]);
                this.sectors = sectorsRes.data;
                this.brands = brandsRes.data;
            } catch (err) {
                console.error(err);
            } finally {
                this.loading = false;
            }
        },

        // --- Sector Methods ---
        async addSector() {
            this.sectorMessage = '';
            this.sectorError = false;
            this.sectorFormLoading = true; // Use a loading state

            // 1. Create a FormData object
            const data = new FormData();
            data.append('name', this.newSector.name);
            data.append('is_featured', this.newSector.is_featured);

            // 2. Append files ONLY if they have been selected
            if (this.newSector.image_url_file) {
                data.append('image_url', this.newSector.image_url_file);
            }
            if (this.newSector.hero_image_url_file) {
                data.append('hero_image_url', this.newSector.hero_image_url_file);
            }

            try {
                const token = Alpine.store('auth').token;
                // 3. Send the request with the correct headers
                const response = await axios.post('/api/admin/sectors', data, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data'
                    }
                });

                this.sectors.push(response.data);
                this.sectors.sort((a, b) => a.name.localeCompare(b.name));
                // Reset the form object and clear file inputs if needed
                this.newSector = { name: '', image_url_file: null, hero_image_url_file: null, is_featured: false };
                this.sectorMessage = 'Sector added!';
                window.dispatchEvent(new CustomEvent('content-updated'));

            } catch (err) {
                this.sectorError = true;
                this.sectorMessage = err.response?.data?.message || 'Failed to add sector.';
            } finally {
                this.sectorFormLoading = false;
            }
        },

        async deleteSector(sectorId) {
            if (!confirm('Are you sure? This will un-categorize its products.')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/sectors/${sectorId}`, { headers: { 'Authorization': `Bearer ${token}` } });

                // THE FIX: Use '==' for loose comparison to handle "26" == 26
                // Or, even better, coerce both to numbers for a strict, reliable comparison.
                this.sectors = this.sectors.filter(s => Number(s.id) !== Number(sectorId));

            } catch (err) { alert('Failed to delete sector.'); }
        },
        // --- Brand Methods ---
        async addBrand() {
            this.brandMessage = '';
            this.brandError = false;
            this.brandFormLoading = true; // Use the new, specific loading state
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post('/api/admin/brands',
                    { name: this.newBrandName },
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                this.brands.push(response.data);
                this.brands.sort((a, b) => a.name.localeCompare(b.name));
                this.newBrandName = '';
                this.brandError = false;
                this.brandMessage = 'Brand added!';
                window.dispatchEvent(new CustomEvent('content-updated'));

            } catch (err) {
                this.brandError = true;
                this.brandMessage = err.response?.data?.message || 'Failed to add brand.';
            } finally {
                this.brandFormLoading = false;
            }
        },

        async deleteBrand(brandId) {
            if (!confirm('Are you sure? This will un-categorize its products.')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/brands/${brandId}`, { headers: { 'Authorization': `Bearer ${token}` } });

                // THE FIX: Apply the same robust comparison here.
                this.brands = this.brands.filter(b => Number(b.id) !== Number(brandId));

            } catch (err) { alert('Failed to delete brand.'); }
        }
    }));

    // 24
    Alpine.data('adminContentPage', () => ({
        slides: [],
        loading: true,
        newSlide: {
            title_text: '',
            subtitle_text: '',
            background_image_url_file: null
        },

        // State for Shop Sections
        shopSections: [],
        newSection: {
            title: '',
            type: 'grid',
            display_order: 0,
            is_active: true,
            start_date: '',
            end_date: ''
        },

        // Add a loading state for collage uploads
        collageFormLoading: null,
        // State to track which item is being edited
        editingSlideId: null,
        editingSectionId: null,

        init() {
            // This watcher will run whenever the user's login state changes.
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                // We also check the role to be safe.
                if (isLoggedIn && Alpine.store('auth').hasRole('Admin')) {
                    this.fetchAllContent();
                } else {
                    // If the user logs out or is not an admin, clear the data.
                    this.loading = false;
                    this.slides = [];
                    this.shopSections = [];
                }
            });

            // This handles the initial page load if the user is already logged in.
            if (Alpine.store('auth').loggedIn && Alpine.store('auth').hasRole('Admin')) {
                this.fetchAllContent();
            } else {
                // If they aren't logged in on page load, we can stop the loading spinner.
                this.loading = false;
            }
        },

        async fetchAllContent() {
            this.loading = true;
            try {
                const token = Alpine.store('auth').token;
                const headers = { 'Authorization': `Bearer ${token}` };
                const [slidesRes, sectionsRes] = await Promise.all([
                    axios.get('/api/admin/hero-slides', { headers }),
                    axios.get('/api/admin/shop-sections', { headers })
                ]);
                this.slides = slidesRes.data;
                this.shopSections = sectionsRes.data;
            } catch (err) { console.error(err); }
            finally { this.loading = false; }
        },

        async addSlide() {
            const data = new FormData();
            data.append('title_text', this.newSlide.title_text);
            data.append('subtitle_text', this.newSlide.subtitle_text);
            if (this.newSlide.background_image_url_file) {
                data.append('background_image_url', this.newSlide.background_image_url_file);
            } else {
                alert('Background image is required.'); return;
            }
            data.append('is_active', true); // Default to active

            try {
                const token = Alpine.store('auth').token;
                const res = await axios.post('/api/admin/hero-slides', data, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } });
                this.slides.push(res.data);
                this.newSlide = { title_text: '', subtitle_text: '', background_image_url_file: null };
            } catch (err) { alert('Failed to add slide.'); console.error(err); }
        },

        async deleteSlide(slideId) {
            if (!confirm('Are you sure you want to delete this entire slide and all its collage images?')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/hero-slides/${slideId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.slides = this.slides.filter(s => s.id !== slideId);
            } catch (err) { alert('Failed to delete slide.'); console.error(err); }
        },

        async addCollageImage(slideId, slideIndex) {
            this.collageFormLoading = slideId; // Set loading state for this specific form

            // 1. Find the specific inputs for this slide using their unique IDs
            const fileInput = document.getElementById(`collage_file_${slideId}`);
            const widthInput = document.getElementById(`collage_width_${slideId}`);
            const heightInput = document.getElementById(`collage_height_${slideId}`);
            const topInput = document.getElementById(`collage_top_${slideId}`);
            const leftInput = document.getElementById(`collage_left_${slideId}`);

            if (!fileInput.files[0]) {
                alert('Please select an image file.');
                this.collageFormLoading = null;
                return;
            }

            // 2. Create FormData and append ALL values
            const data = new FormData();
            data.append('image_url', fileInput.files[0]);
            data.append('width', widthInput.value);
            data.append('height', heightInput.value);
            data.append('top_position', topInput.value);
            data.append('left_position', leftInput.value);
            // You could add z-index here as well if needed

            try {
                const token = Alpine.store('auth').token;
                const res = await axios.post(`/api/admin/hero-slides/${slideId}/collage`, data, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data'
                    }
                });

                // 3. Add the new image to the correct slide's array to update the UI
                this.slides[slideIndex].collage_images.push(res.data);

                // 4. Clear the form inputs for the next upload
                fileInput.value = null;
                widthInput.value = '';
                heightInput.value = '';
                topInput.value = '';
                leftInput.value = '';

            } catch (err) {
                alert('Failed to add collage image.');
                console.error(err);
            } finally {
                this.collageFormLoading = null; // Reset loading state
            }
        },

        async deleteCollageImage(imageId, slideIndex) {
            if (!confirm('Are you sure you want to delete this collage image?')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/collage-images/${imageId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.slides[slideIndex].collage_images = this.slides[slideIndex].collage_images.filter(img => img.id !== imageId);
            } catch (err) { alert('Failed to delete collage image.'); console.error(err); }
        },

        async addShopSection() {
            try {
                const token = Alpine.store('auth').token;
                // Convert empty date strings to null for the database
                const payload = {
                    ...this.newSection,
                    start_date: this.newSection.start_date || null,
                    end_date: this.newSection.end_date || null
                };
                const res = await axios.post('/api/admin/shop-sections', payload, { headers: { 'Authorization': `Bearer ${token}` } });

                this.shopSections.push(res.data);
                this.shopSections.sort((a, b) => a.display_order - b.display_order);
                // Reset form
                this.newSection = { title: '', type: 'grid', display_order: 0, is_active: true, start_date: '', end_date: '' };
            } catch (err) { alert('Failed to add shop section.'); console.error(err); }
        },

        async deleteShopSection(sectionId) {
            if (!confirm('Are you sure you want to delete this section?')) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.delete(`/api/admin/shop-sections/${sectionId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.shopSections = this.shopSections.filter(s => s.id !== sectionId);
            } catch (err) { alert('Failed to delete section.'); console.error(err); }
        },

        // --- NEW EDITING FUNCTIONS ---
        async saveSlide(slide) {
            try {
                const token = Alpine.store('auth').token;
                await axios.put(`/api/admin/hero-slides/${slide.id}`, slide, { headers: { 'Authorization': `Bearer ${token}` } });
                this.editingSlideId = null; // Exit edit mode
            } catch (err) { alert('Failed to save slide.'); console.error(err); }
        },

        async saveSection(section) {
            try {
                const token = Alpine.store('auth').token;
                // Format dates correctly before sending
                const payload = {
                    ...section,
                    start_date: section.start_date || null,
                    end_date: section.end_date || null,
                };
                await axios.put(`/api/admin/shop-sections/${section.id}`, payload, { headers: { 'Authorization': `Bearer ${token}` } });
                this.editingSectionId = null; // Exit edit mode
            } catch (err) { alert('Failed to save section.'); console.error(err); }
        }

    }));

    // 25
    Alpine.data('adminManageSectionPage', () => ({
        sectionId: null,
        section: {},
        allProducts: [],
        linkedProductIds: [],
        filter: '',
        loading: true, error: '',
        saveLoading: false, saveMessage: '', saveError: false,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.sectionId = params.get('id');
            if (this.sectionId) this.fetchData();
            else { this.error = 'No section ID provided.'; this.loading = false; }
        },

        async fetchData() {
            this.loading = true;
            try {
                const token = Alpine.store('auth').token;
                const headers = { 'Authorization': `Bearer ${token}` };
                const [sectionRes, allProductsRes] = await Promise.all([
                    axios.get(`/api/admin/shop-sections/${this.sectionId}`, { headers }),
                    axios.get('/api/admin/products', { headers }) // Fetch all products
                ]);
                this.section = sectionRes.data;
                this.linkedProductIds = sectionRes.data.linked_product_ids;
                this.allProducts = allProductsRes.data.products; // The list of all possible products
            } catch (err) { this.error = 'Failed to load data.'; }
            finally { this.loading = false; }
        },

        // Computed property: returns products currently in the section
        get productsInSection() {
            return this.allProducts.filter(p => this.linkedProductIds.includes(p.id));
        },

        // Computed property: returns products NOT in the section, matching the filter
        get availableProducts() {
            return this.allProducts.filter(p =>
                !this.linkedProductIds.includes(p.id) &&
                p.name.toLowerCase().includes(this.filter.toLowerCase())
            );
        },

        // Move a product from the 'available' list to the 'in section' list
        addProduct(product) {
            this.linkedProductIds.push(product.id);
        },

        // Move a product from the 'in section' list back to the 'available' list
        removeProduct(productId) {
            this.linkedProductIds = this.linkedProductIds.filter(id => id !== productId);
        },

        async saveChanges() {
            this.saveLoading = true; this.saveMessage = ''; this.saveError = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.post(`/api/admin/shop-sections/${this.sectionId}/products`,
                    { productIds: this.linkedProductIds }, // Send the final array of IDs
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                this.saveMessage = response.data.message;
            } catch (err) {
                this.saveMessage = err.response?.data?.message || 'Failed to save changes.';
                this.saveError = true;
            } finally {
                this.saveLoading = false;
            }
        }
    }));

    // 26
    Alpine.data('adminOrdersPage', () => ({
        orders: [],
        loading: true,
        error: '',
        searchTerm: '',
        currentPage: 1,
        totalPages: 1,

        init() {
            // Use a watcher to fetch data only when login is confirmed
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn && ['Admin', 'SBO', 'Superadmin'].includes(Alpine.store('auth').user.role)) {
                    this.fetchOrders();
                }
            });
            if (Alpine.store('auth').loggedIn && ['Admin', 'SBO', 'Superadmin'].includes(Alpine.store('auth').user.role)) {
                this.fetchOrders();
            } else {
                this.loading = false;
            }
        },

        async fetchOrders(page = 1) {
            if (page < 1 || (page > this.totalPages && this.totalPages > 0)) return;
            this.loading = true; this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const params = new URLSearchParams({ page, search: this.searchTerm });
                const response = await axios.get(`/api/admin/orders?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.orders = response.data.orders;
                this.currentPage = response.data.currentPage;
                this.totalPages = response.data.totalPages;
            } catch (err) { this.error = 'Failed to load orders.'; }
            finally { this.loading = false; }
        },
        searchOrders() { this.fetchOrders(1); },
        formatPrice: formatPrice,
    }));

    // 27
    Alpine.data('adminOrderDetailPage', () => ({
        order: {},
        orderId: null,
        loading: true,
        error: '',

        // --- NEW STATE FOR STATUS UPDATES ---
        selectedStatus: '',
        statusLoading: false,
        statusMessage: '',
        statusError: false,

        init() {
            const params = new URLSearchParams(window.location.search);
            this.orderId = params.get('id');
            if (this.orderId) {
                this.fetchOrder();
            } else {
                this.error = 'No order ID provided.';
                this.loading = false;
            }
        },

        async fetchOrder() {
            this.loading = true; this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get(`/api/admin/orders/${this.orderId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.order = response.data;
                this.selectedStatus = this.order.status; // Pre-select the current status in the dropdown
            } catch (err) {
                this.error = err.response?.data?.message || 'Failed to load order details.';
            } finally {
                this.loading = false;
            }
        },

        // --- NEW FUNCTION TO UPDATE THE STATUS ---
        async updateStatus() {
            this.statusLoading = true; this.statusMessage = ''; this.statusError = false;
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.put(`/api/admin/orders/${this.orderId}/status`,
                    { status: this.selectedStatus },
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                // Update the local order object to reflect the change instantly
                this.order.status = response.data.order.status;
                this.statusMessage = response.data.message;
                this.statusError = false;
            } catch (err) {
                this.statusMessage = err.response?.data?.message || 'Failed to update status.';
                this.statusError = true;
            } finally {
                this.statusLoading = false;
            }
        },

        formatPrice: formatPrice,
    }));

    // 28
    Alpine.data('adminInnovationsPage', () => ({
        submissions: [],
        loading: true,
        error: '',

        selectedUser: {},
        userLoading: false,
        userProfileModal: null,

        init() {
            // THE FIX: Use the hasRole() helper to check for permissions.
            // This will correctly return 'true' for both Admins and Superadmins.
            if (Alpine.store('auth').hasRole('Admin')) {
                this.fetchSubmissions();
            } else {
                // Also good practice to stop the loading spinner if the user is not authorized.
                this.loading = false;
            }

            // We can also add a watcher for robustness, in case the user logs in on this page.
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn && Alpine.store('auth').hasRole('Admin')) {
                    this.fetchSubmissions();
                }
            });

            this.$nextTick(() => { this.userProfileModal = new bootstrap.Modal(document.getElementById('userProfileModal')); });
        },

        async fetchSubmissions() {
            this.loading = true;
            this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get('/api/admin/innovations', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.submissions = response.data;
            } catch (err) {
                this.error = 'Failed to load innovation submissions.';
                console.error(err);
            } finally {
                this.loading = false;
            }
        },

        async viewUserProfile(userId) {
            this.userLoading = true;
            this.userProfileModal.show();
            try {
                const token = Alpine.store('auth').token;
                const res = await axios.get(`/api/admin/users/${userId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.selectedUser = res.data;
            } catch (err) { console.error(err); }
            finally { this.userLoading = false; }
        }
    }));

    // 29
    Alpine.data('adminBusinessInquiriesPage', () => ({
        inquiries: [], loading: true, error: '', currentPage: 1, totalPages: 1,
        init() {
            // THE FIX: Use the hasRole() helper to check for permissions.
            // This will correctly return 'true' for both Admins and Superadmins.
            if (Alpine.store('auth').hasRole('Admin')) {
                this.fetchInquiries();
            } else {
                // Also good practice to stop the loading spinner if the user is not authorized.
                this.loading = false;
            }

            // We can also add a watcher for robustness, in case the user logs in on this page.
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn && Alpine.store('auth').hasRole('Admin')) {
                    this.fetchInquiries();
                }
            });
        },

        async fetchInquiries(page = 1) {
            this.loading = true;
            try {
                const token = Alpine.store('auth').token;
                const res = await axios.get(`/api/admin/business-inquiries?page=${page}`, { headers: { 'Authorization': `Bearer ${token}` } });
                this.inquiries = res.data.inquiries;
                this.currentPage = res.data.currentPage;
                this.totalPages = res.data.totalPages;
            } catch (err) { this.error = 'Failed to load inquiries.'; }
            finally { this.loading = false; }
        }
    }));

    // 30
    // public/js/main.js

    // --- REPLACE THE ENTIRE adminApplicationsPage COMPONENT ---
    Alpine.data('adminApplicationsPage', () => ({
        // State for SBO Applications
        sboApplications: [],
        sboLoading: true,

        // State for Business Inquiries
        businessInquiries: [],
        inquiryLoading: true,
        inquiryError: '',
        inquirySearchTerm: '',
        inquiryCurrentPage: 1,
        inquiryTotalPages: 1,

        init() {
            if (Alpine.store('auth').hasRole('Admin')) {
                this.fetchSboApplications();
                this.fetchBusinessInquiries();
            } else {
                this.sboLoading = false;
                this.inquiryLoading = false;
            }
        },

        // --- SBO Methods ---
        async fetchSboApplications() {
            this.sboLoading = true;
            try {
                const token = Alpine.store('auth').token;
                const res = await axios.get('/api/admin/sbo-applications', { headers: { Authorization: `Bearer ${token}` } });
                this.sboApplications = res.data;
            } catch (err) { console.error('Failed to fetch SBO apps', err); }
            finally { this.sboLoading = false; }
        },
        async handleSboApplication(profileId, status) {
            if (!confirm(`Are you sure you want to ${status} this application?`)) return;
            try {
                const token = Alpine.store('auth').token;
                await axios.put(`/api/admin/sbo-applications/${profileId}/status`, { status }, { headers: { Authorization: `Bearer ${token}` } });
                this.sboApplications = this.sboApplications.filter(app => app.id !== profileId);
            } catch (err) { alert('Action failed.'); }
        },

        // --- Business Inquiry Methods ---
        async fetchBusinessInquiries(page = 1) {
            this.inquiryLoading = true;
            try {
                const token = Alpine.store('auth').token;
                const params = new URLSearchParams({ page, search: this.inquirySearchTerm });
                const res = await axios.get(`/api/admin/business-inquiries?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
                // Add a temporary 'newStatus' property for the dropdown
                this.businessInquiries = res.data.inquiries.map(i => ({ ...i, newStatus: i.status }));
                this.inquiryCurrentPage = res.data.currentPage;
                this.inquiryTotalPages = res.data.totalPages;
            } catch (err) { this.inquiryError = 'Failed to load inquiries.'; }
            finally { this.inquiryLoading = false; }
        },
        searchInquiries() {
            this.fetchBusinessInquiries(1);
        },
        async updateInquiryStatus(inquiryId, newStatus) {
            if (!newStatus) { alert('Please select a status.'); return; }
            try {
                const token = Alpine.store('auth').token;
                await axios.put(`/api/admin/business-inquiries/${inquiryId}/status`, { status: newStatus }, { headers: { Authorization: `Bearer ${token}` } });
                // Update status locally for instant feedback
                const inquiry = this.businessInquiries.find(i => i.id === inquiryId);
                if (inquiry) inquiry.status = newStatus;
            } catch (err) { alert('Failed to update status.'); }
        },
        getInquiryStatusClass(status) {
            const classes = { pending: 'bg-warning text-dark', contacted: 'bg-info', resolved: 'bg-success', archived: 'bg-secondary' };
            return classes[status] || 'bg-light text-dark';
        }
    }));

    // 31
    // public/js/main.js
    Alpine.data('productListPage', () => ({
        products: [],
        loading: true,
        pageTitle: '',
        showSearch: false,
        init() {
            const params = new URLSearchParams(window.location.search);
            const type = params.get('type');
            this.pageTitle = params.get('title') || 'Products';

            const endpoints = {
                'new-releases': '/api/products/list/new-releases',
                'best-sellers': '/api/products/list/best-sellers',
                'specials': '/api/products/list/specials'
            };

            if (endpoints[type]) this.fetchProducts(endpoints[type]);
            else this.loading = false;
        },
        async fetchProducts(endpoint) {
            this.loading = true;
            try {
                const res = await axios.get(endpoint);
                this.products = res.data;
            } catch (err) { console.error(err); }
            finally { this.loading = false; }
        },
        formatPrice: formatPrice,
        toggleSearch() {
            this.showSearch = !this.showSearch;
        }
    }));

    //================================================================
    // Initialize the auth store when the app loads
    //================================================================
    Alpine.store('auth').initialize();
    Alpine.store('cart').initialize();
});

