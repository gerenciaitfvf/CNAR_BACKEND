const jwt = require('jsonwebtoken');

const SECRET   = process.env.JWT_SECRET   || 'change-me';
const EXPIRES  = process.env.JWT_EXPIRES_IN || '8h';

const sign = (payload) =>
  jwt.sign(payload, SECRET, { expiresIn: EXPIRES });

const verify = (token) =>
  jwt.verify(token, SECRET);

module.exports = { sign, verify };
