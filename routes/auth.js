const { createAsyncRouter } = require('../middleware/async-router');
const bcrypt = require('bcrypt');

const { preventLogin, preventSetupWhenAdminExists } = require('../middleware/auth');
const {
  createInitialAdmin,
  normalizeUsername,
  validateInitialAdminInput,
} = require('../utils/admin-setup');

const router = createAsyncRouter();

function startAdminSession(req, res, admin, failureRedirectPath, successMessage) {
  return req.session.regenerate((err) => {
    if (err) {
      console.error('Session regeneration failed during authentication:', err);
      req.flash('error', 'Unable to start a secure session. Please try again.');
      return res.redirect(failureRedirectPath);
    }

    req.session.admin = { id: admin.id, username: admin.username };
    req.session.flash = { success: successMessage };
    return res.redirect('/admin');
  });
}

router.get('/setup', preventSetupWhenAdminExists, (req, res) => {
  res.render('admin/setup', {
    formData: {
      username: '',
    },
    hidePlayer: true,
  });
});

router.post('/setup', preventSetupWhenAdminExists, async (req, res) => {
  const db = req.app.locals.db;
  const username = normalizeUsername(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const validationError = validateInitialAdminInput({ username, password, confirmPassword });

  if (validationError) {
    return res.status(400).render('admin/setup', {
      error: validationError,
      formData: { username },
      hidePlayer: true,
    });
  }

  try {
    const admin = await createInitialAdmin(db, { username, password });
    return startAdminSession(req, res, admin, '/setup', 'Initial admin account created successfully.');
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT') {
      req.flash('error', 'Initial setup has already been completed. Please log in.');
      return res.redirect('/login');
    }

    throw err;
  }
});

router.get('/login', preventLogin, (req, res) => {
  res.render('admin/login');
});

router.post('/login', async (req, res) => {
  if (req.adminSetupRequired) {
    req.flash('error', 'Complete the one-time setup to create the first admin account.');
    return res.redirect('/setup');
  }

  const db = req.app.locals.db;
  const { username, password } = req.body;
  const admin = await db.get('SELECT * FROM admins WHERE username = ?', username);
  if (admin && await bcrypt.compare(password, admin.password)) {
    return startAdminSession(req, res, admin, '/login', 'Logged in successfully');
  }
  req.flash('error', 'Invalid credentials');
  res.redirect('/login');
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;