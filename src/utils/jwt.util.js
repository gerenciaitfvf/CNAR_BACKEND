const jwt = require('jsonwebtoken');

const SECRET   = process.env.JWT_SECRET;
if (!SECRET) {
  // Sin secreto no se arranca: un valor por defecto permitiría falsificar tokens
  throw new Error('JWT_SECRET no está configurado. Defínelo en el entorno o en .env');
}
const EXPIRES  = process.env.JWT_EXPIRES_IN || '8h';

const sign = (payload) =>
  jwt.sign(payload, SECRET, { expiresIn: EXPIRES });

const verify = (token) =>
  jwt.verify(token, SECRET);

module.exports = { sign, verify };
