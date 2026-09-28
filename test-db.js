/**
 * Smoke test de la conexión al EC2 (cnar_fvf).
 * Ejecuta: node test-db.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  console.log('Conectando a', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
  });

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 10000,
    });
    await conn.ping();
    console.log('OK  -> ping exitoso al EC2');

    const [ver] = await conn.query('SELECT VERSION() AS v, DATABASE() AS db, @@hostname AS host');
    console.log('OK  -> servidor:', ver[0]);

    const [counts] = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM roles)  AS roles,
        (SELECT COUNT(*) FROM users)  AS users,
        (SELECT COUNT(*) FROM rooms)  AS rooms,
        (SELECT COUNT(*) FROM rooms WHERE room_type='SUITE')    AS suites,
        (SELECT COUNT(*) FROM rooms WHERE room_type='STANDARD') AS standards
    `);
    console.log('OK  -> conteos:', counts[0]);

    const [sample] = await conn.query(`
      SELECT r.room_number, r.floor, r.room_type, r.status,
             u.email, u.staff_kind
        FROM users u
        CROSS JOIN rooms r
       WHERE u.email = 'admin@cnar.gob.ve'
       ORDER BY r.floor, r.room_number
       LIMIT 3
    `);
    console.log('OK  -> muestra rooms:');
    sample.forEach(r => console.log('     ', r));

    process.exit(0);
  } catch (e) {
    console.error('FALLO ->', e.code || e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
})();
