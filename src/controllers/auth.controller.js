const bcrypt = require('bcrypt');
const pool   = require('../config/db');
const { sign } = require('../utils/jwt.util');
const { logAudit } = require('../utils/audit');
const { loginCentral } = require('../services/centralAuth.service');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

const ROLE_SLUG_BY_NAME = {
  superadmin: 'superadmin',
  'coordinador de recepcion': 'coord-reception',
  recepcionista: 'receptionist',
  'coordinador de mantenimiento': 'coord-maintenance',
  camarera: 'cleaning-staff',
};

function staffKindFromRole(roleName) {
  const n = (roleName || '').toLowerCase();
  if (n.includes('limp') || n.includes('clean') || n.includes('camarera')) return 'CLEANING';
  if (n.includes('manten') || n.includes('mainten')) return 'MAINTENANCE';
  if (n.includes('recep')) return 'RECEPTION';
  return 'SYSTEM';
}

async function resolveRoleId(roleName) {
  const norm = (roleName || '').trim().toLowerCase();
  const slug = ROLE_SLUG_BY_NAME[norm];

  if (slug) {
    const [bySlug] = await pool.query('SELECT id FROM roles WHERE slug = ? LIMIT 1', [slug]);
    if (bySlug.length) return bySlug[0].id;
  }
  if (norm) {
    const [byName] = await pool.query(
      'SELECT id FROM roles WHERE LOWER(name) = ? OR slug = ? LIMIT 1',
      [norm, norm]
    );
    if (byName.length) return byName[0].id;
  }
  if (process.env.CNAR_DEFAULT_ROLE_ID) return Number(process.env.CNAR_DEFAULT_ROLE_ID);

  const [fallback] = await pool.query('SELECT id FROM roles ORDER BY id LIMIT 1');
  return fallback.length ? fallback[0].id : null;
}

async function findLocalUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.is_active,
            u.staff_kind, u.role_id, r.slug AS role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

// Alta/actualización "just-in-time" del usuario del hub en la BD local.
async function provisionLocalUser(centralUser) {
  const existing = await findLocalUserByEmail(centralUser.userEmail);
  if (existing) return existing;

  const roleId = await resolveRoleId(centralUser.roleName);
  if (!roleId) {
    const err = new Error('No hay roles configurados en el sistema');
    err.status = 500;
    throw err;
  }

  const fullName =
    `${centralUser.userName || ''} ${centralUser.userLastName || ''}`.trim() ||
    centralUser.userEmail;
  const staffKind = staffKindFromRole(centralUser.roleName);
  const randomHash = await bcrypt.hash(`${Math.random()}${Date.now()}`, SALT_ROUNDS);

  const [result] = await pool.query(
    `INSERT INTO users
       (role_id, full_name, email, password_hash, staff_kind, is_active)
     VALUES (?,?,?,?,?,1)`,
    [roleId, fullName, centralUser.userEmail, randomHash, staffKind]
  );

  return findLocalUserByEmail(centralUser.userEmail) || {
    id: result.insertId,
    full_name: fullName,
    email: centralUser.userEmail,
    is_active: 1,
    staff_kind: staffKind,
    role_id: roleId,
    role_slug: null,
  };
}

function sendLogin(req, res, user) {
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
}

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
 *  1) Intenta autenticar contra el hub central (email/password o
 *     idToken de Google). Si el usuario existe en el hub, se da de
 *     alta/actualiza localmente y se emite JWT local.
 *  2) Si el hub no lo conoce (404) y vino con password, cae al login
 *     local con bcrypt (compatibilidad durante la migración).
 * ---------------------------------------------------------- */
exports.login = async (req, res, next) => {
  try {
    const { email, password, idToken } = req.body;

    if (!idToken && (!email || !password)) {
      return res.status(400).json({ ok: false, message: 'Email y password requeridos' });
    }

    let centralUser = null;
    let centralError = null;

    try {
      centralUser = await loginCentral({ email, password, idToken });
    } catch (err) {
      centralError = err;
    }

    if (centralUser) {
      const user = await provisionLocalUser(centralUser);

      if (!user.is_active) {
        return res.status(403).json({ ok: false, message: 'Usuario inactivo' });
      }

      await logAudit({
        user,
        action:      'auth.login',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 200,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email: user.email, source: 'central' },
      });

      return sendLogin(req, res, user);
    }

    // Fallback local solo para login con password (no Google)
    const centralStatus = centralError?.response?.status;
    const authBackUnreachable = !centralError?.response;

    if (idToken || (centralStatus && centralStatus !== 404)) {
      const status = centralStatus === 403 ? 403 : 401;
      return res.status(status).json({ ok: false, message: 'Credenciales inválidas' });
    }

    if (centralStatus === 404 || authBackUnreachable) {
      const user = await findLocalUserByEmail(email);

      if (!user) {
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

      if (!user.is_active) {
        await logAudit({
          user,
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
          user,
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
        user,
        action:      'auth.login',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 200,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email, source: 'local' },
      });

      return sendLogin(req, res, user);
    }

    return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
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
