const router = require('express').Router();
const ctrl   = require('../controllers/checkin.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.post('/',                          auth, role('superadmin','coord-reception','receptionist'),
                                             ctrl.createCheckIn);
router.get ('/active',                    auth, role('superadmin','coord-reception','receptionist','coord-maintenance'),
                                             ctrl.listActive);
router.get ('/active/room/:roomId',       auth, role('superadmin','coord-reception','receptionist','coord-maintenance'),
                                             ctrl.getActiveByRoom);
router.post('/:bookingId/checkout',       auth, role('superadmin','coord-reception','receptionist'),
                                             ctrl.checkOut);
router.post('/:bookingId/guests',         auth, role('superadmin','coord-reception','receptionist'),
                                             ctrl.addGuestToBooking);
router.delete('/:bookingId/guests/:guestId',
                                          auth, role('superadmin','coord-reception','receptionist'),
                                             ctrl.removeGuestFromBooking);
router.put('/:bookingId/guests/:guestId', auth, role('superadmin','coord-reception','receptionist'),
                                             ctrl.updateGuestInBooking);

module.exports = router;
