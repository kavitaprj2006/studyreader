// ============================================================
// StudyReader — Role & Authentication Middleware Module
// ============================================================

function requireAuth(pool) {
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required."
        });
      }

      const result = await pool.query(
        `SELECT id, name, email, role, is_active, is_approved
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [req.session.userId]
      );

      if (result.rows.length === 0) {
        req.session.destroy(() => {});
        return res.status(401).json({
          success: false,
          message: "User session is no longer valid."
        });
      }

      const user = result.rows[0];

      if (!user.is_active) {
        req.session.destroy(() => {});
        return res.status(403).json({
          success: false,
          message: "Your account is inactive."
        });
      }

      if (!user.is_approved) {
        req.session.destroy(() => {});
        return res.status(403).json({
          success: false,
          message: "Your account is pending administrative approval."
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error("Authentication middleware error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to verify authentication."
      });
    }
  };
}

function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires one of the following roles: [${roles.join(", ")}]. Your current role is '${req.user ? req.user.role : "unauthenticated"}'.`
      });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
