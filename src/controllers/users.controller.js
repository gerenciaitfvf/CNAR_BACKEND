const bcrypt  = require('bcrypt');
const pool    = require('../config/db');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

const STAFF_KINDS = ['CLEANING','MAINTENANCE','RECEPTION','SYSTEM'];
const DOC_TYPES   = ['V','E','PASSPORT'];

const stripHash = ({ password_hash, ...rest }) => rest;

/* ------------------------------------------------------------
 * GET /api/users
 * Query: ?role=slug&staff_kind=X&q=texto&page=1&limit=20
 * ---------------------------------------------------------- */
exports.listUsers = async (req, res, next) => {
  try {
    const { role, staff_kind, q } = req.query;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const args  = [];
    if (role)       { where.push('r.slug = ?');       args.push(role); }
    if (staff_kind) { where.push('u.staff_kind = ?'); args.push(staff_kind); }
    if (q) {
      where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.document_number LIKE ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.document_type, u.document_number,
              u.phone, u.staff_kind, u.is_active, u.created_at, u.updated_at,
              r.id AS role_id, r.name AS role_name, r.slug AS role_slug
         FROM users u
         JOIN roles r ON r.id = u.role_id
         ${whereSql}
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}`,
      args
    );
    const total = countRows[0].total;

    res.json({
      ok: true,
      data: rows.map(stripHash),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/users/staff   (camareras activas)
 * ---------------------------------------------------------- */
exports.listCleaningStaff = async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email
         FROM users u
        WHERE u.staff_kind = 'CLEANING' AND u.is_active = 1
        ORDER BY u.full_name`
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/users/:id
 * ---------------------------------------------------------- */
exports.getUser = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.document_type, u.document_number,
              u.phone, u.staff_kind, u.is_active, u.created_at, u.updated_at,
              r.id AS role_id, r.name AS role_name, r.slug AS role_slug
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, data: stripHash(rows[0]) });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * POST /api/users
 * Body: { full_name, email, password, role_id, staff_kind,
 *         document_type?, document_number?, phone? }
 * Solo superadmin.
 * ---------------------------------------------------------- */
exports.createUser = async (req, res, next) => {
  try {
    const {
      full_name, email, password, role_id, staff_kind,
      document_type, document_number, phone,
    } = req.body;

    if (!full_name || !email || !password || !role_id || !staff_kind) {
      return res.status(400).json({ ok: false, message: 'Faltan campos obligatorios' });
    }
    if (!STAFF_KINDS.includes(staff_kind)) {
      return res.status(400).json({ ok: false, message: 'staff_kind inválido' });
    }
    if (document_type && !DOC_TYPES.includes(document_type)) {
      return res.status(400).json({ ok: false, message: 'document_type inválido' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) return res.status(409).json({ ok: false, message: 'Email ya registrado' });

    const [r] = await pool.query('SELECT id FROM roles WHERE id = ?', [role_id]);
    if (!r.length) return res.status(400).json({ ok: false, message: 'role_id no existe' });

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const [ins] = await pool.query(
      `INSERT INTO users
         (role_id, full_name, email, password_hash, staff_kind,
          document_type, document_number, phone, is_active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [role_id, full_name, email, password_hash, staff_kind,
       document_type || null, document_number || null, phone || null]
    );

    res.status(201).json({
      ok: true, message: 'Usuario creado',
      data: { id: ins.insertId, full_name, email, role_id, staff_kind },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * PUT /api/users/:id
 * Edita datos. Si trae "password" (no vacio) se re-hashea.
 * ---------------------------------------------------------- */
exports.updateUser = async (req, res, next) => {
  try {
    const {
      full_name, email, role_id, staff_kind, is_active,
      document_type, document_number, phone, password,
    } = req.body;

    const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });

    if (staff_kind && !STAFF_KINDS.includes(staff_kind)) {
      return res.status(400).json({ ok: false, message: 'staff_kind inválido' });
    }
    if (document_type && !DOC_TYPES.includes(document_type)) {
      return res.status(400).json({ ok: false, message: 'document_type inválido' });
    }
    if (email) {
      const [du] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id <> ?', [email, req.params.id]);
      if (du.length) return res.status(409).json({ ok: false, message: 'Email ya en uso' });
    }
    if (role_id) {
      const [r] = await pool.query('SELECT id FROM roles WHERE id = ?', [role_id]);
      if (!r.length) return res.status(400).json({ ok: false, message: 'role_id no existe' });
    }
    if (password !== undefined && password !== null && password !== '') {
      if (String(password).length < 8) {
        return res.status(400).json({ ok: false, message: 'La contraseña debe tener al menos 8 caracteres' });
      }
    }

    const fields = [];
    const args   = [];
    const map = {
      full_name, email, role_id, staff_kind, is_active,
      document_type, document_number, phone,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v !== undefined) { fields.push(`${k} = ?`); args.push(v); }
    }
    if (password) {
      const h = await bcrypt.hash(password, SALT_ROUNDS);
      fields.push('password_hash = ?'); args.push(h);
    }
    if (!fields.length) return res.json({ ok: true, message: 'Sin cambios' });

    args.push(req.params.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args);
    res.json({ ok: true, message: 'Usuario actualizado' });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * DELETE /api/users/:id
 * Bloquea si es el único superadmin.
 * ---------------------------------------------------------- */
exports.deleteUser = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, r.slug AS role_slug
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });

    if (rows[0].role_slug === 'superadmin') {
      const [others] = await pool.query(
        `SELECT COUNT(*) AS n FROM users u
           JOIN roles r ON r.id = u.role_id
          WHERE r.slug = 'superadmin' AND u.id <> ? AND u.is_active = 1`,
        [req.params.id]
      );
      if (others[0].n === 0) {
        return res.status(400).json({ ok: false, message: 'No se puede eliminar el único superadmin activo' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ ok: false, message: 'El usuario tiene registros asociados (no se puede eliminar)' });
    }
    next(err);
  }
};

/* ------------------------------------------------------------
 * PATCH /api/users/:id/status   activar/desactivar
 * ---------------------------------------------------------- */
exports.toggleActive = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.is_active, r.slug AS role_slug
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });

    const goingActive = !rows[0].is_active;
    if (!goingActive && rows[0].role_slug === 'superadmin') {
      const [others] = await pool.query(
        `SELECT COUNT(*) AS n FROM users u
           JOIN roles r ON r.id = u.role_id
          WHERE r.slug = 'superadmin' AND u.id <> ? AND u.is_active = 1`,
        [req.params.id]
      );
      if (others[0].n === 0) {
        return res.status(400).json({ ok: false, message: 'No se puede desactivar el único superadmin activo' });
      }
    }

    const next = goingActive ? 1 : 0;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [next, req.params.id]);
    res.json({ ok: true, is_active: !!next });
  } catch (err) { next(err); }
};
