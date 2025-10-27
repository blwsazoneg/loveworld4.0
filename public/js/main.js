import { registerUser, loginUser } from './auth.js';

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

        init() {
            this.fetchAllUsers();
        },

        async fetchAllUsers() {
            this.loading = true;
            this.message = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get('/api/users', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                this.users = response.data;
            } catch (err) {
                this.message = 'Failed to load users.';
                this.error = true;
                console.error('Fetch all users error:', err);
            } finally {
                this.loading = false;
            }
        },

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

                // Update the user's role in the local list to reflect the change instantly
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

        handleFileSelect(event) {
            // event.target.files is a FileList object, we convert it to an array
            this.files = Array.from(event.target.files);
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

        // This function can be simplified as it's not used in this component directly anymore
        formatPrice(priceInUSD) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
            }).format(priceInUSD);
        },

        scrollCarousel(element, distance) {
            element.scrollBy({ left: distance, behavior: 'smooth' });
        }
    }));

    //================================================================
    // 15. PRODUCT DETAIL PAGE COMPONENT (product-detail.html)
    //================================================================
    Alpine.data('productDetailPage', () => ({
        product: {}, productId: null, activeImageUrl: '', quantity: 1, loading: true,
        error: '', cartMessage: '', cartError: false,
        init() {
            const params = new URLSearchParams(window.location.search); this.productId = params.get('id');
            if (this.productId) this.fetchProductDetails(); else { this.error = 'No product ID specified.'; this.loading = false; }
        },
        formatPrice(priceInUSD) {
            if (!priceInUSD) return ''; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInUSD);
        },
        async fetchProductDetails() {
            this.loading = true; this.error = '';
            try {
                const response = await axios.get(`/api/products/${this.productId}`); this.product = response.data;
                if (this.product.images?.length > 0) this.activeImageUrl = this.product.images[0].image_url;
            } catch (err) { this.error = 'Failed to load product details.'; console.error('Fetch product error:', err); } finally { this.loading = false; }
        },
        async addToCart() {
            this.cartMessage = 'Adding...'; this.cartError = false;
            const result = await Alpine.store('cart').addItem(this.productId, this.quantity);
            this.cartMessage = result.message; this.cartError = !result.success;
            setTimeout(() => { this.cartMessage = ''; }, 3000);
        }
    }));

    //================================================================
    // 16. GLOBAL CART STORE
    //================================================================
    Alpine.store('cart', {
        items: [],
        itemCount: 0,

        async initialize() {
            if (Alpine.store('auth').loggedIn) {
                try {
                    const token = Alpine.store('auth').token;
                    const response = await axios.get('/api/cart', { headers: { 'Authorization': `Bearer ${token}` } });
                    this.items = response.data;
                    this.updateItemCount();
                } catch (error) { console.error('Failed to initialize cart:', error); }
            }
        },

        async addItem(productId, quantity) {
            if (!Alpine.store('auth').loggedIn) {
                new bootstrap.Modal(document.getElementById('signInUpModal')).show();
                return { success: false, message: 'Please log in to add items to your cart.' };
            }
            try {
                const token = Alpine.store('auth').token;
                await axios.post('/api/cart/items', { productId, quantity }, { headers: { 'Authorization': `Bearer ${token}` } });
                await this.initialize();
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
        },

        updateItemCount() {
            this.itemCount = this.items.reduce((total, item) => total + item.quantity, 0);
        }
    });


    // ===============================================================
    // 17. CART PAGE COMPONENT
    // ===============================================================
    Alpine.data('cartPage', () => ({
        checkoutError: '', isCheckingOut: false, debounce: null,
        formatPrice(priceInUSD) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInUSD); },
        subtotal() {
            const totalInUSD = Alpine.store('cart').items.reduce((total, item) => total + (item.price * item.quantity), 0);
            return this.formatPrice(totalInUSD);
        },
        updateQuantity(productId, quantity) {
            clearTimeout(this.debounce);
            this.debounce = setTimeout(() => { Alpine.store('cart').updateItem(productId, parseInt(quantity)); }, 500);
        },
        removeItem(productId) { if (confirm('Remove this item?')) Alpine.store('cart').removeItem(productId); },
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

        formatPrice(priceInUSD) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
            }).format(priceInUSD);
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
        formatPrice(priceInUSD) {
            if (!priceInUSD) return '';
            return new Intl.NumberFormat('en-US', {
                style: 'currency', currency: 'USD'
            }).format(priceInUSD);
        },
    }));

    //================================================================
    // 19. ORDER HISTORY PAGE COMPONENT
    //================================================================
    Alpine.data('orderHistoryPage', () => ({
        orders: [],
        loading: true,
        error: '',

        init() {
            // Watch for login/logout to fetch orders automatically
            this.$watch('$store.auth.loggedIn', (isLoggedIn) => {
                if (isLoggedIn) {
                    this.fetchOrders();
                } else {
                    this.orders = []; // Clear orders on logout
                }
            });

            if (Alpine.store('auth').loggedIn) {
                this.fetchOrders();
            } else {
                this.loading = false;
            }

            // Add event listener for when an accordion item is shown
            const accordion = this.$root.querySelector('#orderAccordion');
            if (accordion) {
                accordion.addEventListener('show.bs.collapse', event => {
                    const orderId = event.target.id.split('-')[1];
                    this.fetchOrderDetails(orderId);
                });
            }
        },

        async fetchOrders() {
            this.loading = true; this.error = '';
            try {
                const token = Alpine.store('auth').token;
                const response = await axios.get('/api/orders/my-orders', { headers: { 'Authorization': `Bearer ${token}` } });
                this.orders = response.data.map(order => ({ ...order, items: null, itemsLoading: false }));
            } catch (err) {
                this.error = 'Failed to load order history.';
                console.error(err);
            } finally { this.loading = false; }
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
        },

        formatPrice(priceInUSD) {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInUSD);
        }
    }));



    //================================================================
    // Initialize the auth store when the app loads
    //================================================================
    Alpine.store('auth').initialize();
    Alpine.store('cart').initialize();
});

