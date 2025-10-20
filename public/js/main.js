import { registerUser, loginUser } from './auth.js';

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
        firstName: '', lastName: '', dateOfBirth: '', email: '', phoneNumber: '',
        username: '', password: '', confirmPassword: '', kingschatHandle: '',
        zone: '', church: '', ministryPosition: '', yearsInPosition: '',
        registerMessage: '', registerError: false,
        loginIdentifier: '', loginPassword: '', loginMessage: '', loginError: false,

        kc_profile_id: null,
        kc_avatar_url: null,

        async loginWithKingsChat() {
            this.loginMessage = 'Connecting to KingsChat...';
            this.loginError = false;

            // 1. DOUBLE-CHECK THIS CLIENT ID. Is it correct?
            const loginOptions = {
                scopes: ["profile"],
                clientId: 'b2b522e9-d602-402d-b61d-8a50825862da'
            };

            try {
                console.log("Attempting to call KingsChat SDK...");
                const response = await window.kingsChatWebSdk.login(loginOptions);
                console.log("SDK call successful, received:", response);

                const { accessToken, refreshToken } = response;

                if (!accessToken) {
                    // This will now throw a specific error if the token is missing
                    throw new Error("SDK response did not contain an accessToken.");
                }

                console.log("Attempting to post tokens to backend...");
                const backendResponse = await axios.post('/api/kingschat/login', { accessToken, refreshToken });
                console.log("Backend call successful, received:", backendResponse.data);

                Alpine.store('auth').handleSuccessfulLogin(backendResponse.data);
                this.loginMessage = backendResponse.data.message;
                this.loginError = false;
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('signInUpModal'));
                if (modalInstance) modalInstance.hide();

            } catch (error) {
                // THIS IS THE NEW, DETAILED ERROR LOGGING
                console.error("--- KingsChat Login Flow Failed ---");
                console.error("The raw error object is:", error);

                if (error.response) {
                    // This is an error from OUR backend (e.g., 500, 404)
                    console.error("Error from backend response:", error.response.data);
                    this.loginMessage = error.response.data.message || 'An error occurred on our server.';
                } else if (error.request) {
                    // This is a network error (can't reach the backend)
                    console.error("Network error, cannot reach the server:", error.request);
                    this.loginMessage = 'Cannot connect to the server. Please check your connection.';
                } else {
                    // This is an error from the SDK or a generic JS error
                    console.error("SDK or JavaScript error:", error.message);
                    this.loginMessage = 'KingsChat login failed. Please check for popup blockers or try again.';
                }

                this.loginError = true;
            }
        },

        async handleRegister() {
            this.registerMessage = ''; this.registerError = false;
            if (this.password !== this.confirmPassword) {
                this.registerMessage = 'Passwords do not match.';
                this.registerError = true;
                return;
            }

            const userData = {
                firstName: this.firstName, lastName: this.lastName, dateOfBirth: this.dateOfBirth,
                email: this.email, phoneNumber: this.phoneNumber, username: this.username,
                password: this.password, kingschatHandle: this.kingschatHandle, zone: this.zone,
                church: this.church, ministryPosition: this.ministryPosition,
                yearsInPosition: this.yearsInPosition,
                kingschat_id: this.kc_profile_id,
                kingschat_avatar_url: this.kc_avatar_url
            };

            const result = await registerUser(userData);
            if (result.success) {
                this.registerMessage = result.data.message + " You can now log in.";
                this.registerError = false;
                this.showRegisterForm = false;
            } else {
                this.registerMessage = result.message;
                this.registerError = true;
            }
        },

        async handleLogin() {
            this.loginMessage = ''; this.loginError = false;
            const result = await Alpine.store('auth').login(this.loginIdentifier, this.loginPassword);
            if (result.success) {
                this.loginMessage = result.message;
                this.loginError = false;
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('signInUpModal'));
                if (modalInstance) modalInstance.hide();
            } else {
                this.loginMessage = result.message;
                this.loginError = true;
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
    // Initialize the auth store when the app loads
    //================================================================
    Alpine.store('auth').initialize();
});

