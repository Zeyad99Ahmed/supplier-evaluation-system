const express = require('express');
const { ah, authenticate, requireRole } = require('../../shared');
const c = require('./authController');

const router = express.Router();

router.post('/auth/login', ah(c.login));
router.post('/auth/logout', authenticate, ah(c.logout));
router.get('/auth/me', authenticate, ah(c.me));

router.get('/users', authenticate, requireRole('admin'), ah(c.listUsers));
router.post('/users', authenticate, requireRole('admin'), ah(c.createUser));
router.patch('/users/:id/status', authenticate, requireRole('admin'), ah(c.setUserStatus));

router.get('/admin/activity', authenticate, requireRole('admin'), ah(c.activity));

module.exports = router;
