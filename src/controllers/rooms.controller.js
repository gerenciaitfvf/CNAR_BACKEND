const pool = require('../config/db');

/* ------------------------------------------------------------
 * GET /api/rooms?floor=1
 * Devuelve TODAS las habitaciones con su ultima limpieza
 * y los nombres de las camareras involucradas (N:M).
 * ---------------------------------------------------------- */
exports.listRooms = async (req, res, next) => {
  try {
    const { floor, status } = req.query;

    const where = [];
    const args  = [];
    if (floor)  { where.push('r.floor = ?');  args.push(Number(floor)); }
    if (status) { where.push('r.status = ?'); args.push(status); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rooms] = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.room_type, r.capacity, r.status
         FROM rooms r
         ${whereSql}
         ORDER BY r.floor, r.room_number`,
      args
    );

    if (!rooms.length) {
      return res.json({ ok: true, data: [] });
    }

    // Ultima limpieza por habitacion via subquery correlacionada
    const roomIds = rooms.map(r => r.id);
    const [lastCleanings] = await pool.query(
      `SELECT cr.id, cr.room_id, cr.cleaned_at, cr.notes
         FROM cleaning_records cr
        WHERE cr.id IN (
          SELECT MAX(cr2.id) FROM cleaning_records cr2
           WHERE cr2.room_id = cr.room_id
        )
          AND cr.room_id IN (?)`,
      [roomIds]
    );

    // Camareras (N:M) de cada limpieza
    const cleaningIds = lastCleanings.map(c => c.id);
    let staffRows = [];
    if (cleaningIds.length) {
      const [rows] = await pool.query(
        `SELECT rcs.cleaning_id, u.id AS user_id, u.full_name
           FROM room_cleaning_staff rcs
           JOIN users u ON u.id = rcs.user_id
          WHERE rcs.cleaning_id IN (?)`,
        [cleaningIds]
      );
      staffRows = rows;
    }

    // Indexar
    const staffByCleaning = staffRows.reduce((acc, s) => {
      (acc[s.cleaning_id] = acc[s.cleaning_id] || []).push(s.full_name);
      return acc;
    }, {});

    const lastByRoom = lastCleanings.reduce((acc, c) => {
      acc[c.room_id] = c;
      return acc;
    }, {});

    const data = rooms.map(r => {
      const lc = lastByRoom[r.id];
      return {
        ...r,
        last_cleaning: lc
          ? {
              id: lc.id,
              cleaned_at: lc.cleaned_at,
              notes: lc.notes,
              staff: staffByCleaning[lc.id] || [], // N:M -> array de nombres
            }
          : null,
      };
    });

    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/rooms/:id
 * ---------------------------------------------------------- */
exports.getRoom = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, room_number, floor, room_type, capacity, status, notes
         FROM rooms WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * PATCH /api/rooms/:id/status
 * Cambia el estado de la habitacion (AVAILABLE, OCCUPIED, MAINTENANCE...).
 * ---------------------------------------------------------- */
exports.updateRoomStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['AVAILABLE','OCCUPIED','MAINTENANCE','CLEANING'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: 'Estado inválido' });
    }
    await pool.query('UPDATE rooms SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, message: 'Estado actualizado' });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * POST /api/rooms/:id/cleaning
 * Registra un aseo con UNA o VARIAS camareras (N:M).
 * Body: { staff_ids: [3, 4], notes?: "..." }
 * ---------------------------------------------------------- */
exports.registerCleaning = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { staff_ids = [], notes = null } = req.body;
    if (!Array.isArray(staff_ids) || staff_ids.length === 0) {
      return res.status(400).json({ ok: false, message: 'staff_ids requerido (N:M)' });
    }

    await conn.beginTransaction();
    const [cr] = await conn.query(
      'INSERT INTO cleaning_records (room_id, notes) VALUES (?, ?)',
      [req.params.id, notes]
    );
    const cleaningId = cr.insertId;

    const values = staff_ids.map(uid => [cleaningId, uid]);
    await conn.query(
      'INSERT INTO room_cleaning_staff (cleaning_id, user_id) VALUES ?',
      [values]
    );

    await conn.query(
      "UPDATE rooms SET status = 'AVAILABLE' WHERE id = ? AND status = 'CLEANING'",
      [req.params.id]
    );

    await conn.commit();
    res.status(201).json({ ok: true, cleaning_id: cleaningId });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};
