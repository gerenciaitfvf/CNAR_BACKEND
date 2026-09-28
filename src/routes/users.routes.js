const router = require('express').Router();
const ctrl   = require('../controllers/users.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.get('/',                  auth, role('superadmin','coord-reception','coord-maintenance'),
                                  ctrl.listUsers);
router.get('/staff',             auth, role('superadmin','coord-reception'),
                                  ctrl.listCleaningStaff);
router.get('/:id',               auth, role('superadmin','coord-reception','coord-maintenance'),
                                  ctrl.getUser);
router.post('/',                 auth, role('superadmin'), ctrl.createUser);
router.put('/:id',               auth, role('superadmin'), ctrl.updateUser);
router.delete('/:id',            auth, role('superadmin'), ctrl.deleteUser);
router.patch('/:id/status',      auth, role('superadmin'), ctrl.toggleActive);

module.exports = router;
