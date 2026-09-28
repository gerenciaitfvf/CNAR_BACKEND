const { verify } = require('../utils/jwt.util');
const pool        = require('../config/db');

/**
 * Verifica el JWT y, ADEMAS, confirma que el usuario siga existiendo
 * y activo en la BD. Esto evita tokens huerfanos (usuario borrado o
 * desactivado) que disparan errores de FK en otras tablas.
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ ok: false, message: 'Token no proporcionado' });
    }

    const decoded = verify(token);
    const userId  = decoded.sub;

    const [rows] = await pool.query(
      'SELECT u.id, u.email, u.full_name, u.role_id, u.is_active, r.slug AS role_slug, u.staff_kind FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, message: 'Usuario ya no existe. Inicia sesion nuevamente.' });
    }
    if (!rows[0].is_active) {
      return res.status(401).json({ ok: false, message: 'Usuario inactivo. Inicia sesion nuevamente.' });
    }

    req.user = {
      id:        rows[0].id,
      email:     rows[0].email,
      full_name: rows[0].full_name,
      role_id:   rows[0].role_id,
      role_slug: rows[0].role_slug,
      staff:     rows[0].staff_kind,
    };
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: 'Token invalido o expirado' });
  }
};
