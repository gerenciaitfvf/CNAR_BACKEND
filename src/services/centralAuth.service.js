const axios = require('axios');

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

module.exports = { loginCentral, APP_NAME };
