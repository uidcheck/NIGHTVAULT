const express = require('express');
const router = express.Router();

// home
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const rows = await db.all(
      `SELECT *
       FROM homepage_links
       ORDER BY section, COALESCE(order_index, 999999), title, id`
    );

    const homepageLinks = {
      socials: rows.filter((row) => row.section === 'socials'),
      other: rows.filter((row) => row.section === 'other'),
    };

    res.render('home', { homepageLinks });
  } catch (err) {
    console.error('Home route error:', err);
    res.render('home', {
      homepageLinks: {
        socials: [],
        other: [],
      },
    });
  }
});

router.get('/music', async (req, res) => {
  try {
    const db = req.app.locals.db;
    // fetch playlists and optionally their items for sidebar
    const playlists = await db.all('SELECT * FROM music_playlists ORDER BY title');
    for (const pl of playlists) {
      pl.items = await db.all(
        'SELECT m.* FROM music m JOIN music_playlist_items mpi ON mpi.music_id = m.id WHERE mpi.playlist_id = ? ORDER BY mpi.order_index',
        pl.id
      );
    }

    let sql = 'SELECT * FROM music';
    const params = [];

    // if filtering by playlist we will join, but keep search
    if (req.query.playlist) {
      sql = `SELECT m.* FROM music m
             JOIN music_playlist_items mpi ON mpi.music_id = m.id
             WHERE mpi.playlist_id = ?`;
      params.push(req.query.playlist);
      if (req.query.search) {
        sql += ' AND (m.title LIKE ? OR m.artist LIKE ? OR m.album LIKE ?)';
        const term = `%${req.query.search}%`;
        params.push(term, term, term);
      }
      sql += ' ORDER BY mpi.order_index, m.id';
    } else {
      if (req.query.search) {
        sql += ' WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?';
        const term = `%${req.query.search}%`;
        params.push(term, term, term);
      }
      sql += ' ORDER BY order_index, id';
    }
    const tracks = await db.all(sql, ...params);
    res.render('music', { tracks, search: req.query.search || '', playlists, selectedPlaylist: req.query.playlist || null });
  } catch (err) {
    console.error('Music route error:', err.message);
    res.status(500).send('Error loading music archive: ' + err.message);
  }
});

router.get('/videos', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT * FROM video_playlists ORDER BY title');
  for (const pl of playlists) {
    pl.items = await db.all(
      `SELECT v.*
       FROM videos v
       JOIN video_playlist_items vpi ON vpi.video_id = v.id
       WHERE vpi.playlist_id = ?
         AND v.filename IS NOT NULL
         AND TRIM(v.filename) != ''
       ORDER BY vpi.order_index`,
      pl.id
    );
  }

  let sql = `SELECT * FROM videos
             WHERE filename IS NOT NULL
               AND TRIM(filename) != ''`;
  const params = [];
  if (req.query.playlist) {
    sql = `SELECT v.* FROM videos v
           JOIN video_playlist_items vpi ON vpi.video_id = v.id
           WHERE vpi.playlist_id = ?
             AND v.filename IS NOT NULL
             AND TRIM(v.filename) != ''`;
    params.push(req.query.playlist);
    if (req.query.search) {
      sql += ' AND (v.title LIKE ? OR v.description LIKE ?)';
      const term = `%${req.query.search}%`;
      params.push(term, term);
    }
    if (req.query.category) {
      sql += ' AND v.category LIKE ?';
      params.push(`%${req.query.category}%`);
    }
  } else {
    if (req.query.search) {
      sql += ' WHERE title LIKE ? OR description LIKE ?';
      const term = `%${req.query.search}%`;
      params.push(term, term);
    }
    if (req.query.category) {
      sql += params.length ? ' AND ' : ' WHERE ';
      sql += ' category LIKE ?';
      params.push(`%${req.query.category}%`);
    }
  }
  sql += ' ORDER BY created_at DESC';
  const videos = await db.all(sql, ...params);
  res.render('videos', { videos, search: req.query.search || '', category: req.query.category || '', playlists, selectedPlaylist: req.query.playlist || null });
});

router.get('/gallery', async (req, res) => {
  const db = req.app.locals.db;

  // fetch collections for sidebar with counts
  const collections = await db.all('SELECT * FROM gallery_collections ORDER BY title');
  for (const col of collections) {
    const row = await db.get('SELECT COUNT(*) as cnt FROM gallery_collection_items WHERE collection_id = ?', col.id);
    col.count = row ? row.cnt : 0;
  }

  let sql = 'SELECT * FROM gallery';
  const params = [];

  if (req.query.collection) {
    sql = `SELECT g.* FROM gallery g
           JOIN gallery_collection_items gci ON gci.gallery_id = g.id
           WHERE gci.collection_id = ?`;
    params.push(req.query.collection);
    if (req.query.search) {
      sql += ' AND (g.title LIKE ? OR g.caption LIKE ? OR g.category LIKE ?)';
      const term = `%${req.query.search}%`;
      params.push(term, term, term);
    }
  } else {
    if (req.query.search) {
      sql += ' WHERE title LIKE ? OR caption LIKE ? OR category LIKE ?';
      const term = `%${req.query.search}%`;
      params.push(term, term, term);
    }
  }

  sql += ' ORDER BY created_at DESC';
  const images = await db.all(sql, ...params);

  res.render('gallery', { images, search: req.query.search || '', collections, selectedCollection: req.query.collection || null });
});

router.get('/projects', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const collections = await db.all(`
      SELECT pc.*, COUNT(pci.project_id) AS item_count
      FROM project_collections pc
      LEFT JOIN project_collection_items pci ON pci.collection_id = pc.id
      GROUP BY pc.id
      ORDER BY pc.title
    `);

    const selectedCollectionId = req.query.collection ? parseInt(req.query.collection, 10) : null;
    const selectedCollection = !Number.isNaN(selectedCollectionId)
      ? collections.find(c => c.id === selectedCollectionId) || null
      : null;

    const whereClauses = [];
    const params = [];
    let fromClause = ' FROM projects p ';

    if (selectedCollection) {
      fromClause += ' JOIN project_collection_items pci ON pci.project_id = p.id ';
      whereClauses.push('pci.collection_id = ?');
      params.push(selectedCollection.id);
    }

    if (req.query.search) {
      whereClauses.push('(p.title LIKE ? OR p.summary LIKE ? OR p.tags LIKE ?)');
      const term = `%${req.query.search}%`;
      params.push(term, term, term);
    }

    if (req.query.sort === 'closed') {
      whereClauses.push('LOWER(p.status) = ?');
      params.push('closed');
    } else if (req.query.sort === 'ongoing') {
      whereClauses.push('LOWER(p.status) = ?');
      params.push('ongoing');
    }

    let sql = 'SELECT p.*' + fromClause;
    if (whereClauses.length) {
      sql += ' WHERE ' + whereClauses.join(' AND ');
    }

    // determine order
    let order = 'p.created_at DESC';
    if (req.query.sort === 'oldest') order = 'p.created_at ASC';
    if (req.query.sort === 'newest') order = 'p.created_at DESC';

    sql += ' ORDER BY ' + order;

    const projects = await db.all(sql, ...params);
    return res.render('projects', {
      projects,
      search: req.query.search || '',
      sort: req.query.sort || 'newest',
      collections,
      selectedCollection: selectedCollection ? selectedCollection.id : null,
      selectedCollectionInfo: selectedCollection
    });
  } catch (err) {
    console.error('Projects route error:', err);
    return res.render('projects', {
      projects: [],
      search: req.query.search || '',
      sort: req.query.sort || 'newest',
      collections: [],
      selectedCollection: null,
      selectedCollectionInfo: null
    });
  }
});

router.get('/search', async (req, res) => {
  const db = req.app.locals.db;
  const query = req.query.q || '';
  if (!query) return res.render('search', { results: {}, query });

  const results = {};
  // Search music
  results.music = await db.all('SELECT * FROM music WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?', `%${query}%`, `%${query}%`, `%${query}%`);
  // Search videos
  results.videos = await db.all(
    `SELECT *
     FROM videos
     WHERE filename IS NOT NULL
       AND TRIM(filename) != ''
       AND (title LIKE ? OR description LIKE ?)`,
    `%${query}%`,
    `%${query}%`
  );
  // Search gallery
  results.gallery = await db.all('SELECT * FROM gallery WHERE title LIKE ? OR caption LIKE ?', `%${query}%`, `%${query}%`);
  // Search projects
  results.projects = await db.all('SELECT * FROM projects WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ?', `%${query}%`, `%${query}%`, `%${query}%`);

  res.render('search', { results, query });
});

router.get('/videos/:id', async (req, res) => {
  const db = req.app.locals.db;
  const video = await db.get(
    `SELECT *
     FROM videos
     WHERE id = ?
       AND filename IS NOT NULL
       AND TRIM(filename) != ''`,
    parseInt(req.params.id, 10)
  );
  if (!video) return res.status(404).render('404');
  res.render('video_detail', { video });
});

router.get('/projects/:slug', async (req, res) => {
  const db = req.app.locals.db;
  const project = await db.get('SELECT * FROM projects WHERE slug = ?', req.params.slug);
  if (!project) return res.status(404).render('404');
  const updates = await db.all('SELECT * FROM project_updates WHERE project_id = ? ORDER BY created_at DESC', project.id);
  const documents = await db.all('SELECT * FROM project_documents WHERE project_id = ?', project.id);
  // Add attachments to updates
  for (const update of updates) {
    update.attachments = await db.all('SELECT * FROM project_update_attachments WHERE update_id = ?', update.id);
  }
  res.render('project_detail', { project, updates, documents });
});

module.exports = router;