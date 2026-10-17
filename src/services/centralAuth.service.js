const axios = require('axios');
const pool = require('../config/db');

const APP_NAME = process.env.AUTH_APP_NAME || 'CNAR-FVF';

async function loginCentral({ email, password }) {
  const payload = { email, password, app: APP_NAME };

  const { data } = await axios.post(
    `${process.env.AUTH_URL}/usuario-app-rol/login-app`,
    payload,
    { headers: { Authorization: `Bearer ${process.env.AUTH_TOKEN}` } }
  );
  return data;
}

// Busca el usuario activo en el hub (hub_fvf) para la app de CNAR.
// No requiere token de servicio: consulta directa a la base del hub.
async function findHubUserByEmail(email) {
  const appName = process.env.AUTH_APP_NAME || 'CNAR-FVF';
  const [rows] = await pool.query(
    `SELECT u.nombre AS userName, u.apellido AS userLastName,
            u.email AS userEmail, a.name AS appName, r.nombre AS roleName,
            su.nombre AS statusName, u.id AS userId, u.password AS password
       FROM fvf_hub.usuario_app_rol uar
       JOIN fvf_hub.usuarios u ON uar.usuario_id = u.id
       JOIN fvf_hub.apps a ON uar.app_id = a.id
       JOIN fvf_hub.roles r ON uar.rol_id = r.id
       JOIN fvf_hub.status_usuarios su ON u.status_id = su.id
      WHERE u.email = ? AND su.nombre = 'ACTIVO'`,
    [String(email || '').trim().toLowerCase()]
  );
  // Coincidencia exacta del sistema (antes LIKE '%app%' aceptaba cualquier app parecida)
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return rows.find((r) => norm(r.appName) === norm(appName)) || null;
}

// Cuenta del hub (sin importar la app), solo para distinguir "sin rol en CNAR"
// de "usuario inexistente". No emite sesión.
async function findHubAccountByEmail(email) {
  const [rows] = await pool.query(
    `SELECT u.id AS userId, u.nombre AS userName, u.apellido AS userLastName,
            u.email AS userEmail, su.nombre AS statusName, u.password AS password
       FROM fvf_hub.usuarios u
       JOIN fvf_hub.status_usuarios su ON u.status_id = su.id
      WHERE u.email = ? AND su.nombre = 'ACTIVO'
      LIMIT 1`,
    [String(email || '').trim().toLowerCase()]
  );
  return rows[0] || null;
}

module.exports = { loginCentral, findHubUserByEmail, findHubAccountByEmail, APP_NAME };
