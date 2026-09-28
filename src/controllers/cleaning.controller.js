const pool = require('../config/db');

/* ------------------------------------------------------------
 * GET /api/cleaning-records
 * Query: ?room_id&floor&staff_id&from=YYYY-MM-DD&to=YYYY-MM-DD&page&limit
 * Devuelve TODAS las limpiezas (de cualquier habitacion) con staff
 * ---------------------------------------------------------- */
exports.listCleaning = async (req, res, next) => {
  try {
    const { room_id, floor, staff_id, from, to } = req.query;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const args  = [];
    if (room_id) { where.push('cr.room_id = ?');      args.push(Number(room_id)); }
    if (floor)   { where.push('r.floor = ?');          args.push(Number(floor)); }
    if (staff_id){ where.push('rcs.user_id = ?');      args.push(Number(staff_id)); }
    if (from)    { where.push('DATE(cr.cleaned_at) >= ?'); args.push(from); }
    if (to)      { where.push('DATE(cr.cleaned_at) <= ?'); args.push(to); }

    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT cr.id, cr.room_id, cr.cleaned_at, cr.notes,
              r.room_number, r.floor, r.room_type,
              (SELECT GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ')
                 FROM room_cleaning_staff rcs
                 JOIN users u ON u.id = rcs.user_id
                WHERE rcs.cleaning_id = cr.id) AS staff_names,
              (SELECT COUNT(*) FROM room_cleaning_staff WHERE cleaning_id = cr.id) AS staff_count
         FROM cleaning_records cr
         JOIN rooms r ON r.id = cr.room_id
         LEFT JOIN room_cleaning_staff rcs ON rcs.cleaning_id = cr.id
         ${whereSql}
         GROUP BY cr.id
         ORDER BY cr.cleaned_at DESC
         LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT cr.id) AS total
         FROM cleaning_records cr
         JOIN rooms r ON r.id = cr.room_id
         LEFT JOIN room_cleaning_staff rcs ON rcs.cleaning_id = cr.id
         ${whereSql}`,
      args
    );

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page, limit, total: countRows[0].total,
        totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/rooms/:roomId/cleaning-history
 * Historial completo de limpiezas de una habitacion especifica.
 * ---------------------------------------------------------- */
exports.historyByRoom = async (req, res, next) => {
  try {
    const [r] = await pool.query('SELECT id, room_number, floor FROM rooms WHERE id = ?', [req.params.roomId]);
    if (!r.length) return res.status(404).json({ ok: false, message: 'Habitación no existe' });

    const [rows] = await pool.query(
      `SELECT cr.id, cr.cleaned_at, cr.notes,
              (SELECT GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ')
                 FROM room_cleaning_staff rcs
                 JOIN users u ON u.id = rcs.user_id
                WHERE rcs.cleaning_id = cr.id) AS staff_names,
              (SELECT COUNT(*) FROM room_cleaning_staff WHERE cleaning_id = cr.id) AS staff_count
         FROM cleaning_records cr
        WHERE cr.room_id = ?
        ORDER BY cr.cleaned_at DESC`, [req.params.roomId]);

    res.json({ ok: true, room: r[0], data: rows });
  } catch (err) { next(err); }
};
