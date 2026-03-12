const bcrypt = require('bcrypt');

const MIN_INITIAL_ADMIN_PASSWORD_LENGTH = 8;

function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim() : '';
}

function validateInitialAdminInput({ username, password, confirmPassword }, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const requireConfirmation = options.requireConfirmation !== false;

  if (!normalizedUsername) {
    return 'Username is required.';
  }

  if (!password) {
    return 'Password is required.';
  }

  if (password.length < MIN_INITIAL_ADMIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_INITIAL_ADMIN_PASSWORD_LENGTH} characters long.`;
  }

  if (requireConfirmation && password !== confirmPassword) {
    return 'Password and confirmation must match.';
  }

  return '';
}

async function getAdminCount(db) {
  const row = await db.get('SELECT COUNT(*) AS count FROM admins');
  return row && Number.isInteger(row.count) ? row.count : 0;
}

async function hasAnyAdmin(db) {
  return (await getAdminCount(db)) > 0;
}

async function createInitialAdmin(db, { username, password }) {
  const normalizedUsername = normalizeUsername(username);
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.run(
    'INSERT INTO admins (username, password) VALUES (?, ?)',
    normalizedUsername,
    passwordHash
  );

  return {
    id: result.lastID,
    username: normalizedUsername,
  };
}

async function bootstrapInitialAdminFromEnv(db, env = process.env, logger = console) {
  const username = normalizeUsername(env.INITIAL_ADMIN_USERNAME);
  const password = typeof env.INITIAL_ADMIN_PASSWORD === 'string' ? env.INITIAL_ADMIN_PASSWORD : '';
  const hasUsername = username.length > 0;
  const hasPassword = password.length > 0;

  if (hasUsername !== hasPassword) {
    logger.warn('INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD must both be set to bootstrap the initial admin account. Falling back to the web setup flow.');
    return { created: false, source: 'web' };
  }

  if (!hasUsername && !hasPassword) {
    return { created: false, source: 'web' };
  }

  const validationError = validateInitialAdminInput(
    { username, password, confirmPassword: password },
    { requireConfirmation: false }
  );

  if (validationError) {
    logger.warn(`INITIAL_ADMIN bootstrap skipped: ${validationError} Falling back to the web setup flow.`);
    return { created: false, source: 'web' };
  }

  const admin = await createInitialAdmin(db, { username, password });
  logger.log(`✓ Initial admin account created from environment variables (username: ${admin.username})`);

  return {
    created: true,
    source: 'env',
    admin,
  };
}

module.exports = {
  MIN_INITIAL_ADMIN_PASSWORD_LENGTH,
  bootstrapInitialAdminFromEnv,
  createInitialAdmin,
  getAdminCount,
  hasAnyAdmin,
  normalizeUsername,
  validateInitialAdminInput,
};