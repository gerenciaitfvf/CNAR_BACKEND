const pool = require('../config/db');

/* GET /api/roles */
exports.listRoles = async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.name, r.slug, r.description, r.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count
         FROM roles r
         ORDER BY r.id`
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
};

/* POST /api/roles   { name, slug, description? } */
exports.createRole = async (req, res, next) => {
  try {
    const { name, slug, description = null } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ ok: false, message: 'name y slug son obligatorios' });
    }
    if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
      return res.status(400).json({ ok: false, message: 'slug debe ser kebab-case (a-z, 0-9, -)' });
    }
    const [dup] = await pool.query('SELECT id FROM roles WHERE slug = ? OR name = ?', [slug, name]);
    if (dup.length) return res.status(409).json({ ok: false, message: 'Ya existe un rol con ese nombre o slug' });

    const [ins] = await pool.query(
      'INSERT INTO roles (name, slug, description) VALUES (?,?,?)',
      [name, slug, description]
    );
    res.status(201).json({ ok: true, data: { id: ins.insertId, name, slug, description } });
  } catch (err) { next(err); }
};

/* PUT /api/roles/:id   { name?, description? }   (slug inmutable) */
exports.updateRole = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const [rows] = await pool.query('SELECT id FROM roles WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });

    const fields = [];
    const args   = [];
    if (name        !== undefined) { fields.push('name = ?');        args.push(name); }
    if (description !== undefined) { fields.push('description = ?'); args.push(description); }
    if (!fields.length) return res.json({ ok: true, message: 'Sin cambios' });
    args.push(req.params.id);
    await pool.query(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`, args);
    res.json({ ok: true, message: 'Rol actualizado' });
  } catch (err) { next(err); }
};

/* DELETE /api/roles/:id   (bloquea si tiene usuarios) */
exports.deleteRole = async (req, res, next) => {
  try {
    const [users] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [req.params.id]);
    if (users[0].n > 0) {
      return res.status(409).json({ ok: false, message: 'Rol tiene usuarios asignados' });
    }
    const [r] = await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, message: 'Rol eliminado' });
  } catch (err) { next(err); }
};
