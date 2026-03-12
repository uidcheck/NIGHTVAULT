require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');
const methodOverride = require('method-override');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const { DB_FILE_PATH, ensureDbDirectoryExists } = require('./database/db-config');
const SqliteSessionStore = require('./database/sqlite-session-store');
const {
  attachCsrfToken,
  parseTrustProxySetting,
  validateCsrfTokenForNonMultipart,
} = require('./middleware/security');
const { ensureArchiveVariant, getArchiveImageUrl } = require('./utils/image-variants');
const { bootstrapInitialAdminFromEnv, getAdminCount, hasAnyAdmin } = require('./utils/admin-setup');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const { ensureAdmin } = require('./middleware/auth');

function requestExpectsJson(req) {
  const requestedWith = (req.get('X-Requested-With') || '').toLowerCase();
  const accept = (req.get('Accept') || '').toLowerCase();

  return requestedWith === 'xmlhttprequest' || accept.includes('application/json');
}

function isAdminRequest(req) {
  return req.path === '/admin' || req.path.startsWith('/admin/');
}

function isAuthRequest(req) {
  return req.path === '/login' || req.path === '/logout' || req.path === '/setup';
}

function getErrorStatusCode(err) {
  if (Number.isInteger(err && err.statusCode)) return err.statusCode;
  if (Number.isInteger(err && err.status)) return err.status;
  if (err && err.name === 'MulterError') return 400;
  return 500;
}

function getUserFacingErrorMessage(err, statusCode) {
  if (statusCode >= 500) {
    return 'An unexpected error occurred. Please try again.';
  }

  return (err && err.message) || 'The request could not be completed.';
}

(async () => {
  ensureDbDirectoryExists();
  console.log(`Using SQLite database at: ${DB_FILE_PATH}`);

  const db = await open({
    filename: DB_FILE_PATH,
    driver: sqlite3.Database
  });

  // Enable foreign key constraints
  await db.exec('PRAGMA foreign_keys = ON;');

  // Run schema to ensure all tables exist
  const schemaPath = path.join(__dirname, 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schema);

  // Safety indexes for existing databases (no DB reset required)
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_music_playlist_items_unique ON music_playlist_items(playlist_id, music_id)').catch(() => {});
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_video_playlist_items_unique ON video_playlist_items(playlist_id, video_id)').catch(() => {});
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_collection_items_unique ON gallery_collection_items(collection_id, gallery_id)').catch(() => {});
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_project_collection_items_unique ON project_collection_items(collection_id, project_id)').catch(() => {});
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_project_collection_items_project_collection ON project_collection_items(project_id, collection_id)').catch(() => {});

  // Generate missing video thumbnails
  const videosWithoutThumbs = await db.all('SELECT * FROM videos WHERE thumbnail IS NULL AND filename IS NOT NULL');
  for (const video of videosWithoutThumbs) {
    try {
      const videoPath = path.join(__dirname, 'uploads', 'videos', video.filename);
      const thumbFilename = Date.now() + '_' + video.id + '.jpg';
      const thumbnailPath = path.join(__dirname, 'uploads', 'videos', thumbFilename);
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .on('error', reject)
          .screenshot({
            timestamps: ['1%'],
            filename: path.basename(thumbnailPath),
            folder: path.dirname(thumbnailPath),
            size: '320x240'
          })
          .on('end', () => resolve());
      });
      await db.run('UPDATE videos SET thumbnail = ? WHERE id = ?', thumbFilename, video.id);
      console.log(`Generated thumbnail for video ${video.id}`);
    } catch (err) {
      console.error(`Failed to generate thumbnail for video ${video.id}:`, err);
    }
  }

  async function ensureArchiveVariants(rows, subdir, fieldName) {
    const seen = new Set();
    for (const row of rows) {
      const filename = row[fieldName];
      if (!filename || seen.has(filename)) continue;
      seen.add(filename);
      try {
        await ensureArchiveVariant(subdir, filename);
      } catch (err) {
        console.error(`Failed to generate archive variant for ${subdir}/${filename}:`, err.message);
      }
    }
  }

  await ensureArchiveVariants(await db.all('SELECT cover_image FROM music WHERE cover_image IS NOT NULL'), 'music', 'cover_image');
  await ensureArchiveVariants(await db.all('SELECT filename FROM gallery WHERE filename IS NOT NULL'), 'images', 'filename');
  await ensureArchiveVariants(await db.all('SELECT hero_image FROM projects WHERE hero_image IS NOT NULL'), 'projects', 'hero_image');

  // ============================================================================
  // Bootstrap initial admin account if requested
  // ============================================================================
  try {
    const adminCount = await getAdminCount(db);
    if (adminCount === 0) {
      const bootstrapResult = await bootstrapInitialAdminFromEnv(db, process.env, console);
      if (!bootstrapResult.created) {
        console.log('⚠️  No admin account exists yet. Complete the one-time setup at /setup.');
      }
    } else {
      console.log(`✓ Admin account check passed (${adminCount} admin(s) exist)`);
    }
  } catch (err) {
    console.error('Failed to initialize admin setup state:', err);
    // This is not a fatal error - continue startup
  }

  // make db available via app.locals
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxySetting = parseTrustProxySetting(process.env.TRUST_PROXY, isProduction ? 1 : false);
  const sessionSecret = process.env.SESSION_SECRET;

  app.locals.db = db;
  app.locals.getArchiveImageUrl = getArchiveImageUrl;
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting);

  if (!sessionSecret && isProduction) {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
  }

  if (!sessionSecret) {
    console.warn('SESSION_SECRET is not set. Using a temporary fallback secret for local development only.');
  }

  // view engine
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  // static
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
        return;
      }

      if (['.css', '.js'].includes(ext)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '30d',
    immutable: true,
  }));

  // parsers
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));

  // Initialize persistent session store
  const sessionStore = new SqliteSessionStore(db, {
    cleanupIntervalSeconds: 900 // Clean expired sessions every 15 minutes
  });

  // sessions - now using persistent SQLite store instead of MemoryStore
  app.use(
    session({
      store: sessionStore,
      secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
      name: process.env.SESSION_COOKIE_NAME || 'nightvault.sid',
      proxy: !!trustProxySetting,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction ? 'auto' : false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    })
  );

  // Custom flash middleware - stores messages in session, no external dependency
  app.use((req, res, next) => {
    if (!req.session) {
      req.flash = () => '';
      return next();
    }
    
    if (!req.session.flash) {
      req.session.flash = {};
    }
    
    req.flash = function(type, message) {
      if (typeof message === 'string') {
        // Store message
        req.session.flash[type] = message;
        return;
      }
      // Retrieve and clear message
      const msg = req.session.flash[type] || '';
      delete req.session.flash[type];
      return msg;
    };
    
    next();
  });

  app.use(attachCsrfToken);

  app.use((req, res, next) => {
    hasAnyAdmin(db)
      .then((adminExists) => {
        req.adminExists = adminExists;
        req.adminSetupRequired = !adminExists;
        res.locals.adminSetupRequired = !adminExists;
        next();
      })
      .catch(next);
  });

  // set locals middleware
  app.use((req, res, next) => {
    res.locals.currentUser = req.session.admin || null;
    res.locals.adminSetupRequired = !!req.adminSetupRequired;
    res.locals.hidePlayer = false;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
  });

  app.use(validateCsrfTokenForNonMultipart);

  app.use((req, res, next) => {
    if (!req.adminSetupRequired) {
      return next();
    }

    if (req.path === '/setup') {
      return next();
    }

    if (req.path === '/logout') {
      if (req.session) {
        return req.session.destroy((err) => {
          if (err) {
            return next(err);
          }

          return res.redirect('/setup');
        });
      }

      return res.redirect('/setup');
    }

    if (typeof req.flash === 'function') {
      req.flash('error', 'Complete the one-time setup to create the first admin account.');
    }

    return res.redirect('/setup');
  });

  // routes
  app.use('/', publicRoutes);
  app.use('/', authRoutes);
  app.use('/admin', ensureAdmin, adminRoutes);

  // Error handling middleware
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    const statusCode = getErrorStatusCode(err);
    const adminRequest = isAdminRequest(req);
    const authRequest = isAuthRequest(req);
    const expectsJson = requestExpectsJson(req);
    const userMessage = err && err.name === 'MulterError'
      ? (err.field ? `File upload error in field "${err.field}": ${err.message}` : `File upload error: ${err.message}`)
      : getUserFacingErrorMessage(err, statusCode);

    console.error(`Request error on ${req.method} ${req.originalUrl}:`, err);

    if (expectsJson) {
      return res.status(statusCode).json({ error: userMessage });
    }

    if ((adminRequest || authRequest) && req.method !== 'GET') {
      if (typeof req.flash === 'function') {
        req.flash('error', userMessage);
      }

      const fallbackPath = authRequest
        ? (req.adminSetupRequired ? '/setup' : '/login')
        : '/admin';
      return res.status(statusCode).redirect(req.get('referrer') || fallbackPath);
    }

    if (statusCode === 404) {
      return res.status(404).render('404');
    }

    return res.status(statusCode).render('500', {
      message: userMessage,
      statusCode,
    });
  });

  // 404
  app.use((req, res) => {
    res.status(404).render('404');
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
})();