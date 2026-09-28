const pool = require('../config/db');
const { isoToMysqlDatetime } = require('../utils/date.util');

/* ------------------------------------------------------------
 * POST /api/checkin
 * Crea una reserva (booking) y registra 1..3 huespedes.
 *
 * Body esperado:
 * {
 *   room_id: 7,
 *   check_out_at: "2026-06-25 12:00:00",
 *   notes?: "...",
 *   guests: [
 *     { document_type:"V", document_number:"12345678", full_name:"...", birth_date?:"YYYY-MM-DD", address?:"..." },
 *     ...
 *   ]
 * }
 * ---------------------------------------------------------- */
exports.createCheckIn = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { room_id, check_out_at = null, notes = null, guests = [] } = req.body;
    // El frontend envia ISO con Z (gracias a localDateTimeInputToISO).
    // MySQL DATETIME no acepta ese formato: lo convertimos a 'YYYY-MM-DD HH:MM:SS' UTC.
    const checkOutMysql = isoToMysqlDatetime(check_out_at);

    if (!room_id || !Array.isArray(guests) || guests.length === 0) {
      return res.status(400).json({ ok: false, message: 'room_id y al menos 1 huésped son obligatorios' });
    }
    if (guests.length > 3) {
      return res.status(400).json({ ok: false, message: 'Máximo 3 huéspedes por habitación' });
    }
    for (const g of guests) {
      if (!g.document_type || !g.document_number || !g.full_name) {
        return res.status(400).json({ ok: false, message: 'Cada huésped requiere document_type, document_number y full_name' });
      }
    }

    await conn.beginTransaction();

    // 1) Validar habitacion disponible
    const [roomRows] = await conn.query(
      'SELECT id, status, capacity FROM rooms WHERE id = ? FOR UPDATE', [room_id]);
    if (!roomRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'Habitación no existe' });
    }
    if (roomRows[0].status !== 'AVAILABLE') {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: `Habitación no disponible (${roomRows[0].status})` });
    }
    if (guests.length > roomRows[0].capacity) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: `Capacidad máxima ${roomRows[0].capacity}` });
    }

    // 2) Upsert de huespedes (por documento)
    const guestIds = [];
    for (const g of guests) {
      const [exist] = await conn.query(
        'SELECT id FROM guests WHERE document_type = ? AND document_number = ?',
        [g.document_type, g.document_number]
      );
      if (exist.length) {
        guestIds.push(exist[0].id);
        await conn.query(
          'UPDATE guests SET full_name = ?, birth_date = ?, address = ? WHERE id = ?',
          [g.full_name, g.birth_date || null, g.address || null, exist[0].id]
        );
      } else {
        const [ins] = await conn.query(
          'INSERT INTO guests (document_type, document_number, full_name, birth_date, address) VALUES (?,?,?,?,?)',
          [g.document_type, g.document_number, g.full_name, g.birth_date || null, g.address || null]
        );
        guestIds.push(ins.insertId);
      }
    }

    // 3) Crear booking
    const [bk] = await conn.query(
      `INSERT INTO bookings (room_id, check_in_at, check_out_at, notes, created_by, status)
       VALUES (?, NOW(), ?, ?, ?, 'OPEN')`,
      [room_id, checkOutMysql, notes, req.user.id]
    );
    const bookingId = bk.insertId;

    // 4) Asociar huespedes (N:M)
    const bgValues = guestIds.map((gid, i) => [bookingId, gid, i === 0 ? 1 : 0]);
    await conn.query(
      'INSERT INTO booking_guests (booking_id, guest_id, is_lead) VALUES ?',
      [bgValues]
    );

    // 5) Marcar habitacion como OCUPADA
    await conn.query("UPDATE rooms SET status = 'OCCUPIED' WHERE id = ?", [room_id]);

    await conn.commit();

    res.status(201).json({
      ok: true,
      message: 'Check-In registrado',
      data: { booking_id: bookingId, room_id, guests: guestIds.length },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/* ------------------------------------------------------------
 * GET /api/checkin/active
 * Lista reservas activas (OPEN) con huespedes.
 * ---------------------------------------------------------- */
exports.listActive = async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.room_id, r.room_number, r.floor, b.check_in_at, b.check_out_at,
              b.status, b.notes
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
        WHERE b.status = 'OPEN'
        ORDER BY b.check_in_at DESC`
    );

    if (!rows.length) return res.json({ ok: true, data: [] });

    const ids = rows.map(b => b.id);
    const [guests] = await pool.query(
      `SELECT bg.booking_id, g.id, g.document_type, g.document_number,
              g.full_name, bg.is_lead
         FROM booking_guests bg
         JOIN guests g ON g.id = bg.guest_id
        WHERE bg.booking_id IN (?)`, [ids]);

    const byBooking = guests.reduce((acc, g) => {
      (acc[g.booking_id] = acc[g.booking_id] || []).push(g);
      return acc;
    }, {});

    res.json({
      ok: true,
      data: rows.map(b => ({ ...b, guests: byBooking[b.id] || [] })),
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * POST /api/checkin/:bookingId/checkout
 * Cierra la reserva y libera la habitacion.
 * ---------------------------------------------------------- */
exports.checkOut = async (req, res, next) => {
  try {
    const [r] = await pool.query(
      'SELECT room_id, status FROM bookings WHERE id = ?', [req.params.bookingId]);
    if (!r.length) return res.status(404).json({ ok: false, message: 'Reserva no existe' });
    if (r[0].status !== 'OPEN') return res.status(409).json({ ok: false, message: 'Reserva no está abierta' });

    await pool.query("UPDATE bookings SET status='CLOSED' WHERE id = ?", [req.params.bookingId]);
    await pool.query("UPDATE rooms SET status='CLEANING' WHERE id = ?", [r[0].room_id]);

    res.json({ ok: true, message: 'Check-Out realizado' });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/checkin/active/room/:roomId
 * Devuelve la reserva abierta de una habitacion (con huespedes).
 *   - 200 con booking y huespedes si existe
 *   - 404 si la habitacion no tiene reserva abierta
 * Usado por el modal "Gestionar huespedes".
 * ---------------------------------------------------------- */
exports.getActiveByRoom = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.room_id, b.check_in_at, b.check_out_at, b.status, b.notes,
              r.room_number, r.floor, r.capacity
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
        WHERE b.room_id = ? AND b.status = 'OPEN'
        ORDER BY b.check_in_at DESC
        LIMIT 1`, [req.params.roomId]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Sin reserva abierta' });

    const booking = rows[0];
    const [guests] = await pool.query(
      `SELECT g.id, g.document_type, g.document_number, g.full_name,
              g.birth_date, g.address, bg.is_lead
         FROM booking_guests bg
         JOIN guests g ON g.id = bg.guest_id
        WHERE bg.booking_id = ?
        ORDER BY bg.is_lead DESC, g.full_name`, [booking.id]);
    res.json({ ok: true, data: { ...booking, guests } });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * POST /api/checkin/:bookingId/guests
 * Body: { document_type, document_number, full_name, birth_date?, address?, is_lead? }
 * Agrega un huesped a la reserva (reutiliza si ya existe por documento).
 * Valida contra la capacidad de la habitacion.
 * ---------------------------------------------------------- */
exports.addGuestToBooking = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { document_type, document_number, full_name, birth_date, address, is_lead = 0 } = req.body;
    if (!document_type || !document_number || !full_name) {
      return res.status(400).json({ ok: false, message: 'document_type, document_number y full_name son obligatorios' });
    }
    await conn.beginTransaction();

    // Reserva + capacidad
    const [bk] = await conn.query(
      `SELECT b.id, b.room_id, b.status, r.capacity
         FROM bookings b JOIN rooms r ON r.id = b.room_id
        WHERE b.id = ? FOR UPDATE`, [req.params.bookingId]);
    if (!bk.length) { await conn.rollback(); return res.status(404).json({ ok: false, message: 'Reserva no existe' }); }
    if (bk[0].status !== 'OPEN') { await conn.rollback(); return res.status(409).json({ ok: false, message: 'Reserva no está abierta' }); }

    const [cnt] = await conn.query(
      'SELECT COUNT(*) AS n FROM booking_guests WHERE booking_id = ?', [bk[0].id]);
    if (cnt[0].n >= bk[0].capacity) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: `Habitación ya tiene el máximo de huéspedes (${bk[0].capacity})` });
    }

    // Validar duplicado en la misma reserva
    // Upsert huesped
    const [exist] = await conn.query(
      'SELECT id FROM guests WHERE document_type = ? AND document_number = ?',
      [document_type, document_number]
    );
    let guestId;
    if (exist.length) {
      guestId = exist[0].id;
      await conn.query(
        'UPDATE guests SET full_name = ?, birth_date = ?, address = ? WHERE id = ?',
        [full_name, birth_date || null, address || null, guestId]
      );
    } else {
      const [ins] = await conn.query(
        'INSERT INTO guests (document_type, document_number, full_name, birth_date, address) VALUES (?,?,?,?,?)',
        [document_type, document_number, full_name, birth_date || null, address || null]
      );
      guestId = ins.insertId;
    }

    // Evitar duplicado en esta reserva
    const [dup] = await conn.query(
      'SELECT booking_id FROM booking_guests WHERE booking_id = ? AND guest_id = ?', [bk[0].id, guestId]);
    if (dup.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: 'Huésped ya está en esta reserva' });
    }

    await conn.query(
      'INSERT INTO booking_guests (booking_id, guest_id, is_lead) VALUES (?,?,?)',
      [bk[0].id, guestId, is_lead ? 1 : 0]
    );

    await conn.commit();
    res.status(201).json({ ok: true, message: 'Huésped agregado', data: { guest_id: guestId } });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/* ------------------------------------------------------------
 * DELETE /api/checkin/:bookingId/guests/:guestId
 * Quita un huesped de la reserva. No permite dejar la reserva sin huespedes.
 * ---------------------------------------------------------- */
exports.removeGuestFromBooking = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [bk] = await conn.query(
      'SELECT id, status FROM bookings WHERE id = ? FOR UPDATE', [req.params.bookingId]);
    if (!bk.length) { await conn.rollback(); return res.status(404).json({ ok: false, message: 'Reserva no existe' }); }
    if (bk[0].status !== 'OPEN') { await conn.rollback(); return res.status(409).json({ ok: false, message: 'Reserva no está abierta' }); }

    const [cnt] = await conn.query(
      'SELECT COUNT(*) AS n FROM booking_guests WHERE booking_id = ?', [bk[0].id]);
    if (cnt[0].n <= 1) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: 'La reserva debe tener al menos un huésped. Si todos se van, haz Check-Out.' });
    }

    const [r] = await conn.query(
      'DELETE FROM booking_guests WHERE booking_id = ? AND guest_id = ?',
      [bk[0].id, req.params.guestId]
    );
    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: 'Huésped no está en esta reserva' });
    }

    await conn.commit();
    res.json({ ok: true, message: 'Huésped removido' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/* ------------------------------------------------------------
 * PUT /api/checkin/:bookingId/guests/:guestId
 * Body: { is_lead? }   (promover a titular)
 * ---------------------------------------------------------- */
exports.updateGuestInBooking = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { is_lead } = req.body;
    await conn.beginTransaction();

    const [bk] = await conn.query(
      'SELECT id, status FROM bookings WHERE id = ? FOR UPDATE', [req.params.bookingId]);
    if (!bk.length) { await conn.rollback(); return res.status(404).json({ ok: false, message: 'Reserva no existe' }); }
    if (bk[0].status !== 'OPEN') { await conn.rollback(); return res.status(409).json({ ok: false, message: 'Reserva no está abierta' }); }

    if (is_lead !== undefined) {
      // Solo un titular: limpiar los demas
      if (is_lead) {
        await conn.query('UPDATE booking_guests SET is_lead = 0 WHERE booking_id = ?', [bk[0].id]);
      }
      const [r] = await conn.query(
        'UPDATE booking_guests SET is_lead = ? WHERE booking_id = ? AND guest_id = ?',
        [is_lead ? 1 : 0, bk[0].id, req.params.guestId]
      );
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ ok: false, message: 'Huésped no está en esta reserva' });
      }
    }

    await conn.commit();
    res.json({ ok: true, message: 'Huésped actualizado' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};
