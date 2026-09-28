/**
 * Middleware RBAC por slugs de rol.
 * Uso:  router.delete('/x', auth, requireRole('superadmin'), handler)
 */
module.exports = function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }
    if (!allowed.includes(req.user.role_slug)) {
      return res.status(403).json({ ok: false, message: 'No autorizado para este recurso' });
    }
    next();
  };
};
