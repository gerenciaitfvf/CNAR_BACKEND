/**
 * Helpers para conversiones entre el frontend y MySQL.
 *
 * El frontend trabaja con ISO 8601 ('2026-06-25T18:00:00.000Z').
 * MySQL DATETIME NO acepta ese formato: requiere 'YYYY-MM-DD HH:MM:SS'.
 *
 * Reglas:
 *  - null/undefined  -> null (se envia como NULL a MySQL)
 *  - string vacio   -> null
 *  - ISO con Z       -> 'YYYY-MM-DD HH:MM:SS' en UTC (porque el server guarda UTC)
 *  - 'YYYY-MM-DD'    -> null (no es un datetime valido)
 */
function isoToMysqlDatetime(iso) {
  if (iso === null || iso === undefined) return null;
  const s = String(iso).trim();
  if (!s) return null;
  if (!s.includes('T')) return null;        // es fecha pura u otro formato
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Devuelve 'YYYY-MM-DD HH:MM:SS' en UTC
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { isoToMysqlDatetime };
