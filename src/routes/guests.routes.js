const router = require('express').Router();
const ctrl   = require('../controllers/guests.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

router.get('/lookup',  auth, role('superadmin','coord-reception','receptionist'),
                       ctrl.lookupByDocument);
router.get('/',        auth, role('superadmin','coord-reception','receptionist'),
                       ctrl.listGuests);
router.get('/:id',     auth, role('superadmin','coord-reception','receptionist'),
                       ctrl.getGuest);
router.delete('/:id',  auth, role('superadmin'),
                       ctrl.deleteGuest);

module.exports = router;
