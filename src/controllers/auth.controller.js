const bcrypt = require('bcrypt');
const pool   = require('../config/db');
const { sign } = require('../utils/jwt.util');
const { logAudit } = require('../utils/audit');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

/* ------------------------------------------------------------
 *  POST /api/auth/register
 *  Crea un usuario (camarera, recepcionista, mantenimiento, etc.)
 *  Hashea la contraseña con bcrypt ANTES de persistir.
 * ---------------------------------------------------------- */
exports.register = async (req, res, next) => {
  try {
    const {
      full_name, email, password,
      role_id, staff_kind,
      document_type, document_number, phone,
    } = req.body;

    if (!full_name || !email || !password || !role_id || !staff_kind) {
      return res.status(400).json({ ok: false, message: 'Faltan campos obligatorios' });
    }

    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) {
      return res.status(409).json({ ok: false, message: 'Email ya registrado' });
    }

    // bcrypt.hash -> genera salt + hash en una sola llamada
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.query(
      `INSERT INTO users
         (role_id, full_name, email, password_hash, staff_kind,
          document_type, document_number, phone, is_active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [role_id, full_name, email, password_hash, staff_kind,
       document_type || null, document_number || null, phone || null]
    );

    await logAudit({
      user:        { id: result.insertId, email, role_slug: null },
      action:      'auth.register',
      entity_type: 'user',
      entity_id:   result.insertId,
      method:      'POST',
      path:        '/api/auth/register',
      status_code: 201,
      ip:          req.ip,
      user_agent:  req.headers['user-agent'] || null,
      metadata:    { email, full_name, role_id, staff_kind },
    });

    return res.status(201).json({
      ok: true,
      message: 'Usuario creado',
      user: { id: result.insertId, full_name, email, role_id, staff_kind },
    });
  } catch (err) {
    next(err);
  }
};

/* ------------------------------------------------------------
 *  POST /api/auth/login
 *  Verifica credenciales con bcrypt.compare y emite JWT.
 * ---------------------------------------------------------- */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, message: 'Email y password requeridos' });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.is_active,
              u.staff_kind, u.role_id, r.slug AS role_slug
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.email = ? LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      await logAudit({
        action:      'auth.login.fail',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 401,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email, reason: 'user_not_found' },
      });
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }
    const user = rows[0];

    if (!user.is_active) {
      await logAudit({
        user:        user,
        action:      'auth.login.fail',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 403,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email, reason: 'inactive' },
      });
      return res.status(403).json({ ok: false, message: 'Usuario inactivo' });
    }

    // bcrypt.compare -> compara texto plano contra el hash
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await logAudit({
        user:        user,
        action:      'auth.login.fail',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 401,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email, reason: 'bad_password' },
      });
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    await logAudit({
      user:        user,
      action:      'auth.login',
      entity_type: 'auth',
      method:      'POST',
      path:        '/api/auth/login',
      status_code: 200,
      ip:          req.ip,
      user_agent:  req.headers['user-agent'] || null,
    });

    const token = sign({
      sub:       user.id,
      role_id:   user.role_id,
      role_slug: user.role_slug,
      staff:     user.staff_kind,
    });

    return res.json({
      ok: true,
      token,
      user: {
        id:        user.id,
        full_name: user.full_name,
        email:     user.email,
        role:      user.role_slug,
        staff:     user.staff_kind,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ------------------------------------------------------------
 *  GET /api/auth/me  -> usuario autenticado
 * ---------------------------------------------------------- */
exports.me = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.staff_kind, r.slug AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, user: rows[0] });
  } catch (err) { next(err); }
};
