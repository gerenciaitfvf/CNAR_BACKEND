const router = require('express').Router();
const ctrl   = require('../controllers/rooms.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.get('/',                 auth, ctrl.listRooms);
router.get('/:id',              auth, ctrl.getRoom);
router.patch('/:id/status',     auth, role('superadmin','coord-reception','receptionist','coord-maintenance'),
                                ctrl.updateRoomStatus);
router.post('/:id/cleaning',    auth, role('superadmin','coord-reception','receptionist','cleaning-staff'),
                                ctrl.registerCleaning);

module.exports = router;
