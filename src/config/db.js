const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'cnar_pms',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  // El MySQL del EC2 esta en UTC (@@system_time_zone=UTC) y guarda DATETIME
  // como UTC. Forzamos timezone='+00:00' para que mysql2 no aplique una
  // conversion local (VET) al leer/escribir y devuelva el mismo instante
  // que se almaceno.
  timezone: '+00:00',
});

module.exports = pool;
