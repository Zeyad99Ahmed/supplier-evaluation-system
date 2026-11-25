// Internal routes (service token required; not published on API Gateway).
const express = require('express');
const { ah, internalOnly } = require('../../shared');
const c = require('./orderController');

const router = express.Router();
router.get('/orders/:id', internalOnly(['evaluation-service']), ah(c.internalGetOrder));
router.get('/suppliers/:id/open-orders', internalOnly(['supplier-service']), ah(c.openOrdersForSupplier));

module.exports = router;
