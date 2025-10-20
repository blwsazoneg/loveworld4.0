
// Middleware to check if a user has one of the allowed roles
export const checkRole = (roles) => {
    return (req, res, next) => {
        // req.user is attached by our authenticateToken middleware
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Forbidden: You do not have the required permissions.' });
        }
        next();
    };
};