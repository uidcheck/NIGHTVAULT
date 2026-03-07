/**
 * SQLite Session Store for express-session.
 *
 * This store inherits from express-session Store so built-in helpers such as
 * createSession are available to express-session internals.
 */

const session = require('express-session');

class SqliteSessionStore extends session.Store {
  /**
   * Initialize the session store
   * @param {object} db - sqlite database instance (from sqlite package)
   * @param {object} options - store options
   */
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.options = options;
    
    // Auto-cleanup expired sessions on interval (default: every 15 minutes)
    this.cleanupIntervalSeconds = options.cleanupIntervalSeconds || 900;
    this.startCleanupInterval();
  }

  /**
   * Get a session by ID
   * @param {string} sid - session ID
   * @param {function} callback - callback(err, session)
   */
  get(sid, callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        const row = await this.db.get(
          'SELECT sess FROM sessions WHERE sid = ? AND datetime(expiresAt) > datetime("now")',
          sid
        );

        if (!row) {
          return callback(null, null);
        }

        try {
          const sess = JSON.parse(row.sess);
          callback(null, sess);
        } catch (err) {
          callback(err);
        }
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Set a session
   * @param {string} sid - session ID
   * @param {object} sess - session data
   * @param {function} callback - callback(err)
   */
  set(sid, sess, callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        // Calculate expiration time
        const ttlMs = sess.cookie && sess.cookie.originalMaxAge
          ? sess.cookie.originalMaxAge
          : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + ttlMs);

        const sessStr = JSON.stringify(sess);

        // Use INSERT OR REPLACE to update or insert
        await this.db.run(
          'INSERT OR REPLACE INTO sessions (sid, sess, expiresAt) VALUES (?, ?, ?)',
          sid,
          sessStr,
          expiresAt.toISOString()
        );

        callback(null);
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Touch a session (update expiration only)
   * @param {string} sid - session ID
   * @param {object} sess - session data
   * @param {function} callback - callback(err)
   */
  touch(sid, sess, callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        const ttlMs = sess.cookie && sess.cookie.originalMaxAge
          ? sess.cookie.originalMaxAge
          : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();

        await this.db.run('UPDATE sessions SET expiresAt = ? WHERE sid = ?', expiresAt, sid);
        callback(null);
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Destroy a session
   * @param {string} sid - session ID
   * @param {function} callback - callback(err)
   */
  destroy(sid, callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        await this.db.run('DELETE FROM sessions WHERE sid = ?', sid);
        callback(null);
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Get all session count (optional, used by some middleware)
   * @param {function} callback - callback(err, count)
   */
  length(callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        const row = await this.db.get(
          'SELECT COUNT(*) as count FROM sessions WHERE datetime(expiresAt) > datetime("now")'
        );
        callback(null, row.count);
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Clear all sessions
   * @param {function} callback - callback(err)
   */
  clear(callback) {
    callback = callback || (() => {});

    (async () => {
      try {
        await this.db.run('DELETE FROM sessions');
        callback(null);
      } catch (err) {
        callback(err);
      }
    })();
  }

  /**
   * Start automatic cleanup of expired sessions
   * Runs at the interval specified by cleanupIntervalSeconds
   */
  startCleanupInterval() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalSeconds * 1000);

    // Don't keep process alive if this is the only remaining timer
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Execute cleanup of expired sessions
   */
  cleanup() {
    (async () => {
      try {
        const result = await this.db.run(
          'DELETE FROM sessions WHERE datetime(expiresAt) <= datetime("now")'
        );
        if (result.changes > 0) {
          console.log(`Session store: cleaned up ${result.changes} expired session(s)`);
        }
      } catch (err) {
        console.error('Session store cleanup error:', err);
      }
    })();
  }

  /**
   * Stop the cleanup interval
   * Call this when shutting down the app
   */
  stopCleanupInterval() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

module.exports = SqliteSessionStore;
