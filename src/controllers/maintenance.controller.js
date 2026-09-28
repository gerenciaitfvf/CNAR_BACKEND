const pool = require('../config/db');

const PRIORITY = ['LOW','MEDIUM','HIGH'];
const STATUSES = ['OPEN','IN_PROGRESS','RESOLVED','CLOSED'];

const PRIORITY_LABEL = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };
const STATUS_LABEL   = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' };
const STATUS_STYLE   = {
  OPEN:        'bg-rose-100 text-rose-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED:    'bg-emerald-100 text-emerald-700',
  CLOSED:      'bg-slate-200 text-slate-600',
};

const SELECT = `
  SELECT t.id, t.title, t.description, t.priority, t.status,
         t.opened_at, t.resolved_at,
         t.room_id,    r.room_number, r.floor,
         t.opened_by,  ou.full_name AS opened_by_name,
         t.assigned_to, ta.full_name AS assigned_to_name, ta.email AS assigned_to_email
    FROM maintenance_tickets t
    JOIN rooms r  ON r.id = t.room_id
    JOIN users ou ON ou.id = t.opened_by
    LEFT JOIN users ta ON ta.id = t.assigned_to
`;

/* ------------------------------------------------------------
 * GET /api/maintenance
 * Query: ?floor&room_id&assigned_to&status&priority&q&page&limit
 * ---------------------------------------------------------- */
exports.listTickets = async (req, res, next) => {
  try {
    const { floor, room_id, assigned_to, status, priority, q } = req.query;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const args  = [];
    if (floor)        { where.push('r.floor = ?');       args.push(Number(floor)); }
    if (room_id)      { where.push('r.id = ?');          args.push(Number(room_id)); }
    if (assigned_to)  { where.push('t.assigned_to = ?'); args.push(Number(assigned_to)); }
    if (status)       { where.push('t.status = ?');      args.push(status); }
    if (priority)     { where.push('t.priority = ?');    args.push(priority); }
    if (q) {
      where.push('(t.title LIKE ? OR t.description LIKE ? OR r.room_number LIKE ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.query(
      `${SELECT} ${whereSql} ORDER BY t.opened_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM maintenance_tickets t
         JOIN rooms r ON r.id = t.room_id
         ${whereSql}`,
      args
    );

    res.json({
      ok: true,
      data: rows.map(r => ({ ...r,
        status_label:   STATUS_LABEL[r.status]   || r.status,
        priority_label: PRIORITY_LABEL[r.priority] || r.priority,
        status_style:   STATUS_STYLE[r.status],
      })),
      pagination: {
        page, limit, total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/maintenance/:id
 * ---------------------------------------------------------- */
exports.getTicket = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`${SELECT} WHERE t.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({
      ok: true,
      data: { ...rows[0],
        status_label:   STATUS_LABEL[rows[0].status]   || rows[0].status,
        priority_label: PRIORITY_LABEL[rows[0].priority] || rows[0].priority,
        status_style:   STATUS_STYLE[rows[0].status],
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * POST /api/maintenance
 * Body: { room_id, title, description?, priority?, assigned_to? }
 * Status arranca en OPEN.
 * ---------------------------------------------------------- */
exports.createTicket = async (req, res, next) => {
  try {
    const { room_id, title, description = null, priority = 'MEDIUM', assigned_to = null } = req.body;
    if (!room_id || !title) {
      return res.status(400).json({ ok: false, message: 'room_id y title son obligatorios' });
    }
    if (priority && !PRIORITY.includes(priority)) {
      return res.status(400).json({ ok: false, message: 'priority inválida' });
    }

    const [r] = await pool.query('SELECT id FROM rooms WHERE id = ?', [room_id]);
    if (!r.length) return res.status(400).json({ ok: false, message: 'room_id no existe' });

    if (assigned_to) {
      const [u] = await pool.query(
        'SELECT id FROM users WHERE id = ? AND staff_kind = "MAINTENANCE" AND is_active = 1', [assigned_to]);
      if (!u.length) return res.status(400).json({ ok: false, message: 'Tecnico invalido o inactivo' });
    }

    const [ins] = await pool.query(
      `INSERT INTO maintenance_tickets
         (room_id, opened_by, assigned_to, title, description, priority, status)
       VALUES (?,?,?,?,?,?, 'OPEN')`,
      [room_id, req.user.id, assigned_to, title, description, priority]
    );

    res.status(201).json({ ok: true, message: 'Ticket creado', data: { id: ins.insertId } });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * PUT /api/maintenance/:id
 * Edita title, description, priority, assigned_to, status.
 * ---------------------------------------------------------- */
exports.updateTicket = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, status FROM maintenance_tickets WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });

    const { title, description, priority, assigned_to, status } = req.body;
    if (priority && !PRIORITY.includes(priority)) {
      return res.status(400).json({ ok: false, message: 'priority inválida' });
    }
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, message: 'status inválido' });
    }
    if (assigned_to) {
      const [u] = await pool.query(
        'SELECT id FROM users WHERE id = ? AND staff_kind = "MAINTENANCE"', [assigned_to]);
      if (!u.length) return res.status(400).json({ ok: false, message: 'Tecnico invalido' });
    }

    const fields = [];
    const args   = [];
    const map = { title, description, priority, assigned_to, status };
    for (const [k, v] of Object.entries(map)) {
      if (v !== undefined) { fields.push(`${k} = ?`); args.push(v); }
    }
    // resolved_at se setea automatico
    if (status === 'RESOLVED' || status === 'CLOSED') {
      fields.push('resolved_at = NOW()');
    } else if (status && (status === 'OPEN' || status === 'IN_PROGRESS') && rows[0].status !== 'OPEN' && rows[0].status !== 'IN_PROGRESS') {
      fields.push('resolved_at = NULL');
    }

    if (!fields.length) return res.json({ ok: true, message: 'Sin cambios' });
    args.push(req.params.id);
    await pool.query(`UPDATE maintenance_tickets SET ${fields.join(', ')} WHERE id = ?`, args);
    res.json({ ok: true, message: 'Ticket actualizado' });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * DELETE /api/maintenance/:id   (superadmin)
 * ---------------------------------------------------------- */
exports.deleteTicket = async (req, res, next) => {
  try {
    const [r] = await pool.query('DELETE FROM maintenance_tickets WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, message: 'Ticket eliminado' });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/maintenance/rooms/:roomId/history
 * Historial completo de tickets de mantenimiento de una habitacion.
 * (mismo patron que cleaning-records/rooms/:id/cleaning-history)
 * ---------------------------------------------------------- */
exports.historyByRoom = async (req, res, next) => {
  try {
    const [r] = await pool.query('SELECT id, room_number, floor FROM rooms WHERE id = ?', [req.params.roomId]);
    if (!r.length) return res.status(404).json({ ok: false, message: 'Habitación no existe' });

    const [rows] = await pool.query(
      `SELECT id, title, description, priority, status, opened_at, resolved_at,
              opened_by, (SELECT full_name FROM users WHERE id = opened_by)   AS opened_by_name,
              assigned_to, (SELECT full_name FROM users WHERE id = assigned_to) AS assigned_to_name
         FROM maintenance_tickets
        WHERE room_id = ?
        ORDER BY opened_at DESC`, [req.params.roomId]);

    res.json({ ok: true, room: r[0], data: rows });
  } catch (err) { next(err); }
};
