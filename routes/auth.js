const { createAsyncRouter } = require('../middleware/async-router');
const bcrypt = require('bcrypt');

const { preventLogin } = require('../middleware/auth');

const router = createAsyncRouter();

router.get('/login', preventLogin, (req, res) => {
  res.render('admin/login');
});

router.post('/login', async (req, res) => {
  const db = req.app.locals.db;
  const { username, password } = req.body;
  const admin = await db.get('SELECT * FROM admins WHERE username = ?', username);
  if (admin && await bcrypt.compare(password, admin.password)) {
    return req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration failed during login:', err);
        req.flash('error', 'Unable to start a secure session. Please try again.');
        return res.redirect('/login');
      }

      req.session.admin = { id: admin.id, username: admin.username };
      req.session.flash = { success: 'Logged in successfully' };
      return res.redirect('/admin');
    });
  }
  req.flash('error', 'Invalid credentials');
  res.redirect('/login');
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;