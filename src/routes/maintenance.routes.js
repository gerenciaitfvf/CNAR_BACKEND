const router = require('express').Router();
const ctrl   = require('../controllers/maintenance.controller');
const auth   = require('../middleware/auth.middleware');
const role   = require('../middleware/role.middleware');

// Lectura: superadmin, coord-maintenance, coord-reception, receptionist
router.get('/',       auth, role('superadmin','coord-maintenance','coord-reception','receptionist'),
                       ctrl.listTickets);
router.get('/:id',    auth, role('superadmin','coord-maintenance','coord-reception','receptionist'),
                       ctrl.getTicket);

// Escritura: superadmin, coord-maintenance
router.post('/',         auth, role('superadmin','coord-maintenance'), ctrl.createTicket);
router.put('/:id',       auth, role('superadmin','coord-maintenance'), ctrl.updateTicket);
router.delete('/:id',    auth, role('superadmin'),                     ctrl.deleteTicket);

// Historial por habitacion
router.get('/rooms/:roomId/history', auth, role('superadmin','coord-maintenance','coord-reception'),
                                      ctrl.historyByRoom);

module.exports = router;
