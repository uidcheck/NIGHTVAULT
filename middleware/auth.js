module.exports.ensureAdmin = (req, res, next) => {
  if (req.session && req.session.admin) {
    return next();
  }
  req.flash('error', 'Please log in to access that page.');
  res.redirect('/login');
};

module.exports.preventLogin = (req, res, next) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin');
  }
  next();
};