// Evaluation Service public routes. Only Staff submit ratings (an Admin cannot rate on behalf of Staff,
// proposal section 6.1); authorship is checked in the controller.
const express = require('express');
const { ah, authenticate, requireRole } = require('../../shared');
const c = require('./evaluationController');

const router = express.Router();
const anyUser = [authenticate, requireRole('admin', 'staff')];
const staff = [authenticate, requireRole('staff')];
const admin = [authenticate, requireRole('admin')];

router.get('/evaluations', anyUser, ah(c.listEvaluations));
router.get('/evaluations/orders/:orderId', anyUser, ah(c.getByOrder));
router.post('/evaluations', staff, ah(c.submitRating));
router.put('/evaluations/:id', staff, ah(c.updateRating));
router.delete('/evaluations/:id', staff, ah(c.deleteRating));

router.get('/performance/compare', anyUser, ah(c.compare));
router.get('/performance/suppliers/:id', anyUser, ah(c.performance));
router.post('/performance/suppliers/:id/sync', admin, ah(c.resync));

router.get('/rates/convert', anyUser, ah(c.convertQuery)); // before /:currency
router.get('/rates/:currency', anyUser, ah(c.getRate));

module.exports = router;
