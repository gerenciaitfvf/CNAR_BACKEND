/**
 * Seeder de habitaciones en Node.
 * Equivalente al seed.sql, útil cuando se quiere inicializar
 * la base sin tocar el cliente MySQL.
 *
 * Uso:  npm run seed:rooms
 */
require('dotenv').config();
const pool = require('../config/db');

const ROOMS = [
  { floor: 1, type: 'STANDARD', qty: 12 },
  { floor: 2, type: 'STANDARD', qty: 12 },
  { floor: 3, type: 'STANDARD', qty: 12 },
  { floor: 4, type: 'STANDARD', qty: 12 },
  { floor: 5, type: 'SUITE',    qty:  6 },
];

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM room_cleaning_staff');
    await conn.query('DELETE FROM cleaning_records');
    await conn.query('DELETE FROM booking_guests');
    await conn.query('DELETE FROM bookings');
    await conn.query('DELETE FROM rooms');

    const rows = [];
    for (const cfg of ROOMS) {
      for (let i = 1; i <= cfg.qty; i++) {
        const num = `${cfg.floor}${String(i).padStart(2, '0')}`;
        rows.push([num, cfg.floor, cfg.type, 3, 'AVAILABLE']);
      }
    }
    await conn.query(
      'INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES ?',
      [rows]
    );
    await conn.commit();
    console.log(`[SEED] ${rows.length} habitaciones insertadas.`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    process.exit(0);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
