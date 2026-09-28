const router   = require('express').Router();
const ctrl     = require('../controllers/audit.controller');
const auth     = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');

// TODAS las rutas de auditoría son EXCLUSIVAS del superadmin.
router.use(auth, requireRole('superadmin'));

router.get('/',        ctrl.listLogs);
router.get('/facets',  ctrl.facets);

module.exports = router;
