// Supplier Service public routes (published on API Gateway). Every route requires a valid login;
// writes require the admin role. Enforcement is here in the backend, not only in the UI.
const express = require('express');
const { ah, authenticate, requireRole } = require('../../shared');
const c = require('./supplierController');

const router = express.Router();
const anyUser = [authenticate, requireRole('admin', 'staff')];
const admin = [authenticate, requireRole('admin')];

router.get('/categories', anyUser, ah(c.listCategories));
router.post('/categories', admin, ah(c.createCategory));

router.get('/suppliers/recommendations', anyUser, ah(c.recommendations)); // before /:id
router.get('/suppliers', anyUser, ah(c.searchSuppliers));
router.post('/suppliers', admin, ah(c.createSupplier));
router.get('/suppliers/:id', anyUser, ah(c.getSupplier));
router.put('/suppliers/:id', admin, ah(c.updateSupplier));
router.patch('/suppliers/:id/status', admin, ah(c.changeStatus));
router.delete('/suppliers/:id', admin, ah(c.archiveSupplier));

router.post('/suppliers/:id/contacts', admin, ah(c.addContact));
router.delete('/suppliers/:id/contacts/:contactId', admin, ah(c.deleteContact));

router.post('/suppliers/:id/contracts', admin, ah(c.addContract));
router.patch('/contracts/:contractId', admin, ah(c.updateContract));

module.exports = router;
