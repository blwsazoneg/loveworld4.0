// Function to handle user registration
export async function registerUser(userData) {
    try {
        const response = await axios.post('/api/users/register', userData);
        console.log('Registration successful:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('Registration failed:', error.response ? error.response.data : error.message);
        return { success: false, message: error.response ? error.response.data.message : 'Network error or server unavailable.' };
    }
}

// Function to handle user login
export async function loginUser(credentials) {
    try {
        const response = await axios.post('/api/users/login', credentials);
        console.log('Login successful:', response.data);
        // Store token and user info (e.g., in localStorage or Alpine store)
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        return { success: true, data: response.data };
    } catch (error) {
        console.error('Login failed:', error.response ? error.response.data : error.message);
        return { success: false, message: error.response ? error.response.data.message : 'Network error or server unavailable.' };
    }
}