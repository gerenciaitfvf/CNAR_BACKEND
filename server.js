require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const app  = require('./src/app');
const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`CNAR PMS API -> http://localhost:${port}`);
});
