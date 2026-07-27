const express = require('express');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

router.get('/me', adminAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
