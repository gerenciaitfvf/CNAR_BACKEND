const pool = require('../config/db');

const DOC_LABEL = { V: 'Cédula (V)', E: 'Cédula (E)', PASSPORT: 'Pasaporte' };

/* ------------------------------------------------------------
 * GET /api/guests/lookup?document_type=V&document_number=12345
 * Devuelve un huesped por documento (o 404 si no existe).
 * Usado por el modal de Check-In para autocompletar.
 * ---------------------------------------------------------- */
exports.lookupByDocument = async (req, res, next) => {
  try {
    const { document_type, document_number } = req.query;
    if (!document_type || !document_number) {
      return res.status(400).json({ ok: false, message: 'document_type y document_number requeridos' });
    }
    if (!['V','E','PASSPORT'].includes(document_type)) {
      return res.status(400).json({ ok: false, message: 'document_type inválido' });
    }
    const docNum = String(document_number).trim();
    if (!docNum) {
      return res.status(400).json({ ok: false, message: 'document_number vacío' });
    }

    const [rows] = await pool.query(
      `SELECT id, document_type, document_number, full_name, birth_date, address, created_at
         FROM guests
        WHERE document_type = ? AND document_number = ?
        LIMIT 1`,
      [document_type, docNum]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'Huésped no registrado' });
    }
    res.json({
      ok: true,
      data: { ...rows[0], document_type_label: DOC_LABEL[rows[0].document_type] },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/guests
 * Query: ?q=texto&document_type=V|E|PASSPORT
 * Lista huespedes con conteo de visitas y ultima fecha.
 * ---------------------------------------------------------- */
exports.listGuests = async (req, res, next) => {
  try {
    const { q, document_type } = req.query;
    const where = ['1=1'];
    const args  = [];

    if (q) {
      where.push('(g.full_name LIKE ? OR g.document_number LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    if (document_type) {
      where.push('g.document_type = ?');
      args.push(document_type);
    }

    const [rows] = await pool.query(
      `SELECT g.id, g.document_type, g.document_number, g.full_name,
              g.birth_date, g.address, g.created_at,
              (SELECT COUNT(*) FROM booking_guests bg
                JOIN bookings b ON b.id = bg.booking_id
                WHERE bg.guest_id = g.id)                       AS visits,
              (SELECT MAX(b.check_in_at) FROM booking_guests bg
                JOIN bookings b ON b.id = bg.booking_id
                WHERE bg.guest_id = g.id)                       AS last_visit
         FROM guests g
        WHERE ${where.join(' AND ')}
        ORDER BY g.full_name`,
      args
    );

    res.json({
      ok: true,
      data: rows.map(r => ({ ...r, document_type_label: DOC_LABEL[r.document_type] || r.document_type })),
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * GET /api/guests/:id
 * Devuelve el huesped + historial de estancias.
 * ---------------------------------------------------------- */
exports.getGuest = async (req, res, next) => {
  try {
    const [g] = await pool.query('SELECT * FROM guests WHERE id = ?', [req.params.id]);
    if (!g.length) return res.status(404).json({ ok: false, message: 'No existe' });
    const guest = g[0];

    const [history] = await pool.query(
      `SELECT b.id AS booking_id, b.check_in_at, b.check_out_at, b.status,
              r.id AS room_id, r.room_number, r.floor
         FROM booking_guests bg
         JOIN bookings b ON b.id = bg.booking_id
         JOIN rooms    r ON r.id = b.room_id
        WHERE bg.guest_id = ?
        ORDER BY b.check_in_at DESC`,
      [req.params.id]
    );

    res.json({
      ok: true,
      data: {
        ...guest,
        document_type_label: DOC_LABEL[guest.document_type] || guest.document_type,
        history,
      },
    });
  } catch (err) { next(err); }
};

/* ------------------------------------------------------------
 * DELETE /api/guests/:id   (superadmin)
 * Bloquea si tiene reservas asociadas.
 * ---------------------------------------------------------- */
exports.deleteGuest = async (req, res, next) => {
  try {
    const [bg] = await pool.query(
      'SELECT COUNT(*) AS n FROM booking_guests WHERE guest_id = ?', [req.params.id]);
    if (bg[0].n > 0) {
      return res.status(409).json({ ok: false, message: 'Huésped tiene reservas registradas; no se puede eliminar' });
    }
    const [r] = await pool.query('DELETE FROM guests WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, message: 'No existe' });
    res.json({ ok: true, message: 'Huésped eliminado' });
  } catch (err) { next(err); }
};
