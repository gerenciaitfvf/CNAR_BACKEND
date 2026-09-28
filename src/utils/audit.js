/**
 * Auditoría del sistema.
 *
 * `logAudit(...)`  -> inserta una fila en audit_logs.
 * `auditMiddleware()` -> middleware Express que registra automáticamente
 *                        toda mutación (POST/PUT/PATCH/DELETE) hecha por
 *                        un usuario autenticado, una vez que la respuesta
 *                        se envió (`res.on('finish')`).
 *
 * Nunca lanza: un fallo al escribir el log NO debe tumbar la request
 * principal. Se loguea con console.error para que quede en PM2.
 */
const pool = require('../config/db');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths que NO se auditan (ruido / recursión)
function shouldSkip(path) {
  if (!path) return true;
  if (path === '/api/health' || path.startsWith('/api/health/')) return true;
  if (path.startsWith('/api/audit-logs')) return true; // evita recursión
  return false;
}

/**
 * Inserta una fila en audit_logs.
 * user puede ser null (ej. login fallido sin usuario identificado).
 */
async function logAudit({
  user          = null,
  action,
  entity_type   = null,
  entity_id     = null,
  method        = null,
  path          = null,
  status_code   = null,
  ip            = null,
  user_agent    = null,
  metadata      = null,
}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, user_email, user_role, action, entity_type, entity_id,
          method, path, status_code, ip, user_agent, metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        user?.id    ?? null,
        user?.email ?? null,
        user?.role  ?? user?.role_slug ?? null,
        action,
        entity_type,
        entity_id,
        method,
        path ? String(path).slice(0, 255) : null,
        status_code,
        ip,
        user_agent ? String(user_agent).slice(0, 255) : null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[audit] No se pudo escribir el log:', err.message);
  }
}

/**
 * Middleware: registra mutaciones autenticadas al finalizar la respuesta.
 * Si la request no está autenticada o el método no es de mutación, no hace nada.
 *
 * `action` y `entity` se infieren de method + path. Si la ruta expone algo
 * más rico, el controller puede llamar a `logAudit()` directamente.
 */
function auditMiddleware() {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (shouldSkip(req.originalUrl)) return next();

    res.on('finish', () => {
      // Solo si la request pasó por auth (req.user seteado por authMiddleware)
      if (!req.user) return;

      const { action, entity_type, entity_id } = inferFromPath(req.method, req.originalUrl);
      logAudit({
        user:        req.user,
        action,
        entity_type,
        entity_id,
        method:      req.method,
        path:        req.originalUrl,
        status_code: res.statusCode,
        ip:          req.ip,
        user_agent:  req.headers['user-agent'] || null,
        metadata:    summarizeBody(req.body),
      });
    });

    next();
  };
}

/**
 * Heurística: deriva un action legible y entity_type/entity_id del path.
 * Ejemplos:
 *   POST   /api/rooms/4/cleaning  -> room.cleaning.create  (room, 4)
 *   PATCH  /api/rooms/7/status    -> room.status.update    (room, 7)
 *   DELETE /api/maintenance/12    -> maintenance.delete    (maintenance, 12)
 *   POST   /api/checkin           -> checkin.create        (checkin, null)
 *   POST   /api/auth/login        -> auth.login            (auth, null)
 */
function inferFromPath(method, rawPath) {
  const path = (rawPath || '').split('?')[0];
  const parts = path.split('/').filter(Boolean); // ['api', 'rooms', '4', 'cleaning']

  // /api/auth/login, /api/auth/register, /api/auth/logout
  if (parts[1] === 'auth' && parts[2]) {
    return { action: `auth.${parts[2]}`, entity_type: 'auth', entity_id: null };
  }

  // /api/cleaning-records/...
  if (parts[1] === 'cleaning-records') {
    return { action: `${method.toLowerCase()}.cleaning_records`, entity_type: 'cleaning_record', entity_id: numOrNull(parts[2]) };
  }

  const resource = parts[1] || 'unknown';
  const id       = numOrNull(parts[2]);
  const sub      = parts[3];

  // /api/rooms/:id/cleaning  o  /api/rooms/:id/status
  if (resource === 'rooms' && sub) {
    return {
      action:      `${resource}.${sub}.${methodVerb(method)}`,
      entity_type: resource,
      entity_id:   id,
    };
  }

  // /api/maintenance/:id
  // /api/users/:id
  // /api/roles/:id
  // /api/guests/:id
  return {
    action:      `${resource}.${methodVerb(method)}`,
    entity_type: resource === 'maintenance' ? 'maintenance' : resource === 'users' ? 'user' : resource,
    entity_id:   id,
  };
}

function methodVerb(m) {
  switch (m) {
    case 'POST':   return 'create';
    case 'PUT':    return 'update';
    case 'PATCH':  return 'update';
    case 'DELETE': return 'delete';
    default:       return m.toLowerCase();
  }
}

function numOrNull(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === String(v) ? n : null;
}

/**
 * Sanitiza el body para guardar en `metadata`. Saca passwords, hashes, tokens.
 */
const SENSITIVE_KEYS = /password|token|secret|hash|jwt|authorization/i;
function summarizeBody(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '***';
    } else if (Array.isArray(v)) {
      out[k] = `[array len=${v.length}]`;
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { logAudit, auditMiddleware };
