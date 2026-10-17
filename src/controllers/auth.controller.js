const bcrypt = require('bcrypt');
const pool   = require('../config/db');
const { sign } = require('../utils/jwt.util');
const { logAudit } = require('../utils/audit');
const { loginCentral, findHubUserByEmail, findHubAccountByEmail } = require('../services/centralAuth.service');
const { staffKindFromRole, resolveRoleId } = require('../services/hubRoles');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

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
  // Usuarios y roles viven en el hub: el rol de CNAR-FVF del hub es el que vale.
  const roleId = await resolveRoleId(centralUser.roleName);
  if (!roleId) {
    console.warn(
      `Rol del hub "${centralUser.roleName}" sin equivalente en CNAR (${centralUser.userEmail}). ` +
      'Roles válidos: Superadmin, Coordinador de Recepcion, Recepcionista, Coordinador de Mantenimiento, Camarera'
    );
    const err = new Error(`Tu rol "${centralUser.roleName}" no está habilitado en CNAR. Pide al administrador un rol válido de CNAR.`);
    err.status = 403;
    throw err;
  }

  const existing = await findLocalUserByEmail(centralUser.userEmail);
  if (existing) {
    if (existing.role_id !== roleId) {
      await pool.query('UPDATE users SET role_id = ? WHERE id = ?', [roleId, existing.id]);
      return findLocalUserByEmail(centralUser.userEmail);
    }
    return existing;
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
 *  1) Autentica correo y contraseña contra el hub central. Si el
 *     usuario existe en el hub, se da de alta/actualiza localmente y
 *     se emite JWT local.
 *  2) Si auth-back no responde, valida contra la BD del hub directamente.
 *  Ya no hay login con contraseñas locales: usuarios y roles están en el hub.
 * ---------------------------------------------------------- */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: 'Email y password requeridos' });
    }

    let centralUser = null;
    let centralError = null;

    try {
      centralUser = await loginCentral({ email, password });
    } catch (err) {
      centralError = err;
      // 403 = AUTH_TOKEN inválido; sin status = AUTH_URL inalcanzable; 429 = demasiados intentos
      console.warn(
        `login-app en auth-back falló para ${email}: ${err.response?.status ?? 'sin respuesta'} ${err.response?.data?.error ?? err.message}`
      );
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

    // Sin respuesta del hub (auth-back caído o 404): validación directa en la BD del hub
    const centralStatus = centralError?.response?.status;
    const authBackUnreachable = !centralError?.response;

    if (centralStatus === 429) {
      return res.status(429).json({ ok: false, message: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.' });
    }
    if (centralStatus === 403) {
      const data = centralError?.response?.data || {};
      return res.status(403).json({
        ok: false,
        error: data.error || 'ACCESS_DENIED',
        message: data.message || 'No tienes permisos asignados para acceder a CNAR',
      });
    }
    if (centralStatus && centralStatus !== 404) {
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    if (centralStatus === 404 || authBackUnreachable) {
      // Hub directo primero: misma cuenta/clave que el resto de las apps.
      try {
        const hubUser = await findHubUserByEmail(email);
        if (hubUser && hubUser.password) {
          const hubOk = await bcrypt.compare(password, hubUser.password);
          if (hubOk) {
            const local = await provisionLocalUser(hubUser);
            if (local.is_active) {
              await logAudit({
                user: local,
                action:      'auth.login',
                entity_type: 'auth',
                method:      'POST',
                path:        '/api/auth/login',
                status_code: 200,
                ip:          req.ip,
                user_agent:  req.headers['user-agent'] || null,
                metadata:    { email: local.email, source: 'hub_direct' },
              });
              return sendLogin(req, res, local);
            }
          }
        } else if (!hubUser) {
          // La cuenta existe y la clave es correcta, pero no tiene rol CNAR.
          const account = await findHubAccountByEmail(email);
          if (account && account.password) {
            const accountOk = await bcrypt.compare(password, account.password);
            if (accountOk) {
              return res.status(403).json({
                ok: false,
                error: 'ACCESS_DENIED',
                message: 'No tienes permisos asignados para acceder a CNAR',
              });
            }
          }
        }
      } catch (err) {
        console.error('Error en auth hub directo:', err.message);
        // Rol del hub sin equivalente en CNAR: se informa en vez de "credenciales inválidas"
        if (err.status === 403) {
          return res.status(403).json({ ok: false, message: err.message });
        }
      }

      await logAudit({
        action:      'auth.login.fail',
        entity_type: 'auth',
        method:      'POST',
        path:        '/api/auth/login',
        status_code: 401,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    { email, reason: 'not_in_hub' },
      });
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
