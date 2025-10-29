const ROLES = {
    User: [],
    SBO: ['User'],
    Admin: ['SBO'],
    Superadmin: ['Admin']
};

/**
 * Checks if a user has a required role, including inherited roles.
 * @param {string} userRole - The role of the currently logged-in user (e.g., 'Superadmin').
 * @param {string} requiredRole - The minimum role required for the route (e.g., 'SBO').
 * @returns {boolean} - True if the user has the required permissions.
 */
function hasPermission(userRole, requiredRole) {
    // A user always has their own role's permissions.
    if (userRole === requiredRole) {
        return true;
    }

    // Now, check for inherited permissions.
    // e.g., if userRole is 'Admin', inheritedRoles will be ['SBO']
    const inheritedRoles = ROLES[userRole];
    if (inheritedRoles) {
        // Does the array of inherited roles include the one we need?
        // e.g., is 'SBO' in ['SBO']? -> true
        if (inheritedRoles.includes(requiredRole)) {
            return true;
        }
        // Check recursively: Does an Admin's inherited SBO role also have the required permissions?
        // e.g., if requiredRole is 'User', we check if hasPermission('SBO', 'User') is true.
        for (const inheritedRole of inheritedRoles) {
            if (hasPermission(inheritedRole, requiredRole)) {
                return true;
            }
        }
    }
    return false;
}

// The checkRole middleware now uses our new hasPermission logic.
export const checkRole = (requiredRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.role;

        if (!userRole) {
            return res.status(403).json({ message: 'Forbidden: Role not found on user token.' });
        }

        // Check if the user's role has permission for ANY of the required roles.
        const hasAccess = requiredRoles.some(requiredRole => hasPermission(userRole, requiredRole));

        if (hasAccess) {
            next(); // Permission granted
        } else {
            return res.status(403).json({ message: 'Forbidden: You do not have the required permissions.' });
        }
    };
};