const router = require('express').Router();
const ctrl   = require('../controllers/roles.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.get('/',          auth, role('superadmin','coord-reception','coord-maintenance'),
                          ctrl.listRoles);
router.post('/',         auth, role('superadmin'), ctrl.createRole);
router.put('/:id',       auth, role('superadmin'), ctrl.updateRole);
router.delete('/:id',    auth, role('superadmin'), ctrl.deleteRole);

module.exports = router;
