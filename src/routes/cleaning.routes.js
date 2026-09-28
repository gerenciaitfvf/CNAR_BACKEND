const router = require('express').Router();
const ctrl   = require('../controllers/cleaning.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.get('/',                                  auth, role('superadmin','coord-reception','receptionist','coord-maintenance','cleaning-staff'),
                                                  ctrl.listCleaning);
router.get('/rooms/:roomId/cleaning-history',    auth, role('superadmin','coord-reception','receptionist','coord-maintenance','cleaning-staff'),
                                                  ctrl.historyByRoom);

module.exports = router;
