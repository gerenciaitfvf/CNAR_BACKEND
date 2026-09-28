const pool = require('../config/db');

/* ------------------------------------------------------------
 * GET /api/audit-logs
 * Query: ?user_id&action&entity_type&entity_id&ip&from=YYYY-MM-DD&to&page&limit&q
 * SOLO superadmin.
 * ---------------------------------------------------------- */
exports.listLogs = async (req, res, next) => {
  try {
    const { user_id, action, entity_type, entity_id, ip } = req.query;
    const q = (req.query.q || '').trim();
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const args  = [];
    if (user_id)     { where.push('a.user_id = ?');     args.push(Number(user_id)); }
    if (action)      { where.push('a.action = ?');       args.push(action); }
    if (entity_type) { where.push('a.entity_type = ?');  args.push(entity_type); }
    if (entity_id)   { where.push('a.entity_id = ?');    args.push(Number(entity_id)); }
    if (ip)          { where.push('a.ip = ?');           args.push(ip); }
    if (req.query.from) { where.push('a.created_at >= ?'); args.push(`${req.query.from} 00:00:00`); }
    if (req.query.to)   { where.push('a.created_at <= ?'); args.push(`${req.query.to} 23:59:59`); }
    if (q) {
      where.push('(a.action LIKE ? OR a.path LIKE ? OR a.user_email LIKE ? OR a.ip LIKE ?)');
      const like = `%${q}%`;
      args.push(like, like, like, like);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT a.id, a.user_id, a.user_email, a.user_role,
              a.action, a.entity_type, a.entity_id,
              a.method, a.path, a.status_code, a.ip, a.user_agent, a.metadata,
              a.created_at
         FROM audit_logs a
         ${whereSql}
         ORDER BY a.id DESC
         LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`,
      args
    );

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page, limit,
        total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/audit-logs/facets
 * Devuelve listas de valores distintos para poblar los filtros:
 *  - users:  [{ id, full_name, email }]
 *  - actions: [string]
 *  - entity_types: [string]
 *  - ips: [string] (top 100)
 * ---------------------------------------------------------- */
exports.facets = async (_req, res, next) => {
  try {
    const [users] = await pool.query(
      `SELECT DISTINCT a.user_id AS id, u.full_name, a.user_email AS email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.user_id IS NOT NULL
        ORDER BY u.full_name`
    );
    const [actions] = await pool.query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action`
    );
    const [entities] = await pool.query(
      `SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type`
    );
    const [ips] = await pool.query(
      `SELECT DISTINCT ip FROM audit_logs WHERE ip IS NOT NULL ORDER BY ip LIMIT 100`
    );
    res.json({
      ok: true,
      data: {
        users:        users.map(u => ({ id: u.id, full_name: u.full_name, email: u.email })),
        actions:      actions.map(a => a.action),
        entity_types: entities.map(e => e.entity_type),
        ips:          ips.map(i => i.ip),
      },
    });
  } catch (err) { next(err); }
};
