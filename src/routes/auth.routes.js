const router  = require('express').Router();
const ctrl    = require('../controllers/auth.controller');
const auth    = require('../middleware/auth.middleware');
const role    = require('../middleware/role.middleware');

// Alta de usuarios solo para superadmin (antes era pública)
router.post('/register', auth, role('superadmin'), ctrl.register);
router.post('/login',    ctrl.login);
router.get ('/me',       auth, ctrl.me);

module.exports = router;
