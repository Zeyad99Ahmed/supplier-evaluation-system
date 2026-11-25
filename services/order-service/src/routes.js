// Order Service public routes. Staff and Admin can raise orders; ownership is checked inside the
// controller (staff see only their own orders); approval is admin-only.
const express = require('express');
const { ah, authenticate, requireRole } = require('../../shared');
const c = require('./orderController');

const router = express.Router();
const anyUser = [authenticate, requireRole('admin', 'staff')];
const admin = [authenticate, requireRole('admin')];

router.get('/orders/summary', anyUser, ah(c.summary)); // before /:id
router.get('/orders', anyUser, ah(c.listOrders));
router.post('/orders', anyUser, ah(c.createOrder));
router.get('/orders/:id', anyUser, ah(c.getOrder));
router.patch('/orders/:id/status', anyUser, ah(c.updateStatus));
router.patch('/orders/:id/approval', admin, ah(c.decideApproval));
router.post('/orders/:id/convert', anyUser, ah(c.retryConversion));

module.exports = router;
