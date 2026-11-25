// Internal routes (service token required; not published on API Gateway).
const express = require('express');
const { ah, internalOnly } = require('../../shared');
const c = require('./evaluationController');

const router = express.Router();
router.post('/convert', internalOnly(['order-service', 'supplier-service']), ah(c.internalConvert));

module.exports = router;
