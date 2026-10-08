const jwt = require('jsonwebtoken');

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'intranet-develop-f2ff5';

let cache = { at: 0, certs: null };

async function getCerts(force = false) {
  if (!force && cache.certs && Date.now() - cache.at < 60 * 60 * 1000) {
    return cache.certs;
  }
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error('No se pudieron obtener los certificados de Google');
  cache = { at: Date.now(), certs: await res.json() };
  return cache.certs;
}

// Verifica el idToken de Firebase de Google sin necesidad de firebase-admin.
// Devuelve el email (dominio fvf.com.ve) o lanza error.
async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('idToken requerido');
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error('idToken inválido');
  }

  const certs = await getCerts();
  const cert = certs[decoded.header.kid];
  if (!cert) {
    cache = { at: 0, certs: null };
    throw new Error('Certificado no encontrado para el token');
  }

  const payload = jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: PROJECT_ID,
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
  });

  if (!payload.email || !payload.email_verified) {
    throw new Error('Correo de Google no verificado');
  }
  if (payload.firebase?.sign_in_provider !== 'google.com') {
    throw new Error('Método de autenticación no permitido');
  }
  if (payload.hd !== 'fvf.com.ve') {
    throw new Error('Dominio no autorizado');
  }

  return payload.email.trim().toLowerCase();
}

module.exports = { verifyGoogleIdToken };