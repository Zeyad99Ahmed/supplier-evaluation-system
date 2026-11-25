// Internal routes: only reachable with a service token from an allowed caller, and NOT published on
// API Gateway (on AWS they are reached with lambda:InvokeFunction only).
const express = require('express');
const { ah, internalOnly } = require('../../shared');
const c = require('./supplierController');

const router = express.Router();
router.get('/suppliers/:id/eligibility', internalOnly(['order-service']), ah(c.eligibility));
router.put('/suppliers/:id/performance', internalOnly(['evaluation-service']), ah(c.updatePerformance));

module.exports = router;
