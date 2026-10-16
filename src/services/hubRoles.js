// Roles del hub (app CNAR-FVF) -> roles locales de CNAR.
// Compartido por el login (auth.controller) y la sincronización del personal.
const pool = require('../config/db');

// Compara nombres sin tildes, mayúsculas ni espacios extra:
// 'Coordinador de Recepción' == 'coordinador de recepcion'
const normName = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ROLE_SLUG_BY_NAME = {
  superadmin: 'superadmin',
  'coordinador de recepcion': 'coord-reception',
  recepcionista: 'receptionist',
  'coordinador de mantenimiento': 'coord-maintenance',
  camarera: 'cleaning-staff',
};

function staffKindFromRole(roleName) {
  const n = normName(roleName);
  if (n.includes('limp') || n.includes('clean') || n.includes('camarer') || n.includes('aseo')) return 'CLEANING';
  if (n.includes('manten') || n.includes('mainten')) return 'MAINTENANCE';
  if (n.includes('recep')) return 'RECEPTION';
  return 'SYSTEM';
}

// Rol del hub -> id del rol local. null si no hay equivalente (acceso denegado).
async function resolveRoleId(roleName) {
  const norm = normName(roleName);
  if (!norm) return null;

  const [roles] = await pool.query('SELECT id, name, slug FROM roles');
  const slug = ROLE_SLUG_BY_NAME[norm];
  const match =
    (slug && roles.find((r) => r.slug === slug)) ||
    roles.find((r) => normName(r.name) === norm || normName(r.slug) === norm);
  if (match) return match.id;

  if (process.env.CNAR_DEFAULT_ROLE_ID) return Number(process.env.CNAR_DEFAULT_ROLE_ID);

  // Rol del hub no reconocido: se deniega (antes se tomaba el primer rol de la
  // tabla, que podía ser superadmin).
  return null;
}

module.exports = { ROLE_SLUG_BY_NAME, normName, staffKindFromRole, resolveRoleId };
