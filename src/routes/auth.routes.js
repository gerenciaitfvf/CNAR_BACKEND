const router  = require('express').Router();
const ctrl    = require('../controllers/auth.controller');
const auth    = require('../middleware/auth.middleware');
const role    = require('../middleware/role.middleware');

router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.get ('/me',       auth, ctrl.me);

module.exports = router;
