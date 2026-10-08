const axios = require('axios');
const pool = require('../config/db');

const APP_NAME = process.env.AUTH_APP_NAME || 'CNAR-FVF';

async function loginCentral({ email, password, idToken }) {
  const payload = idToken
    ? { idToken, app: APP_NAME }
    : { email, password, app: APP_NAME };

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
            su.nombre AS statusName, u.id AS userId
       FROM fvf_hub.usuario_app_rol uar
       JOIN fvf_hub.usuarios u ON uar.usuario_id = u.id
       JOIN fvf_hub.apps a ON uar.app_id = a.id
       JOIN fvf_hub.roles r ON uar.rol_id = r.id
       JOIN fvf_hub.status_usuarios su ON u.status_id = su.id
      WHERE u.email = ? AND a.name LIKE ? AND su.nombre = 'ACTIVO'
      LIMIT 1`,
    [(email || '').trim().toLowerCase(), `%${appName}%`]
  );
  return rows[0] || null;
}

module.exports = { loginCentral, findHubUserByEmail, APP_NAME };
