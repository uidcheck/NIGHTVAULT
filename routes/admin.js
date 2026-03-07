const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const mm = require('music-metadata');

// set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// ============================================================================
// FILE DELETION HELPERS
// ============================================================================

/**
 * Safely delete a file from disk, handling missing files gracefully
 * @param {string} filePath - Path to the file to delete
 * @returns {Promise<boolean>} - true if deleted, false if already missing or error
 */
const safeDeleteFile = async (filePath) => {
  if (!filePath) return false;
  
  try {
    // Check if file exists first
    await fs.promises.access(filePath, fs.constants.F_OK);
    // File exists, delete it
    await fs.promises.unlink(filePath);
    console.log(`Deleted file: ${filePath}`);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, not an error
      console.log(`File already missing (skipped): ${filePath}`);
      return false;
    }
    // Other error, log but don't throw
    console.error(`Error deleting file ${filePath}:`, err.message);
    return false;
  }
};

/**
 * Delete uploaded file given just the filename and upload subdirectory
 * @param {string} filename - Just the filename (e.g., '1234567890.mp3')
 * @param {string} subdir - Upload subdirectory (e.g., 'music', 'videos', 'images')
 */
const deleteUploadedFile = async (filename, subdir) => {
  if (!filename) return false;
  const filePath = path.join(__dirname, '..', 'uploads', subdir, filename);
  return await safeDeleteFile(filePath);
};

/**
 * Delete all files associated with a music track
 */
const deleteMusicFiles = async (db, musicId) => {
  const track = await db.get('SELECT filename, cover_image FROM music WHERE id = ?', musicId);
  if (!track) return;
  
  // Delete audio file
  await deleteUploadedFile(track.filename, 'music');
  
  // Delete cover image if present
  if (track.cover_image) {
    await deleteUploadedFile(track.cover_image, 'music');
  }
};

/**
 * Delete all files associated with a video
 */
const deleteVideoFiles = async (db, videoId) => {
  const video = await db.get('SELECT filename, thumbnail FROM videos WHERE id = ?', videoId);
  if (!video) return;
  
  // Delete video file
  if (video.filename) {
    await deleteUploadedFile(video.filename, 'videos');
  }
  
  // Delete thumbnail if present
  if (video.thumbnail) {
    await deleteUploadedFile(video.thumbnail, 'videos');
  }
};

/**
 * Delete all files associated with a gallery item
 */
const deleteGalleryFiles = async (db, galleryId) => {
  const img = await db.get('SELECT filename FROM gallery WHERE id = ?', galleryId);
  if (!img) return;
  
  await deleteUploadedFile(img.filename, 'images');
};

/**
 * Delete all files associated with a project
 */
const deleteProjectFiles = async (db, projectId) => {
  const proj = await db.get('SELECT hero_image FROM projects WHERE id = ?', projectId);
  if (!proj) return;
  
  // Delete hero image if present
  if (proj.hero_image) {
    await deleteUploadedFile(proj.hero_image, 'projects');
  }
  
  // Delete project documents
  const docs = await db.all('SELECT filename FROM project_documents WHERE project_id = ?', projectId);
  for (const doc of docs) {
    await deleteUploadedFile(doc.filename, 'documents');
  }
  
  // Delete all update attachments for all updates belonging to this project
  const updates = await db.all('SELECT id FROM project_updates WHERE project_id = ?', projectId);
  for (const update of updates) {
    await deleteProjectUpdateFiles(db, update.id);
  }
};

/**
 * Delete all attachment files for a project update
 */
const deleteProjectUpdateFiles = async (db, updateId) => {
  const attachments = await db.all('SELECT filename FROM project_update_attachments WHERE update_id = ?', updateId);
  for (const att of attachments) {
    await deleteUploadedFile(att.filename, 'documents');
  }
};

// helper function to generate video thumbnail
const generateVideoThumbnail = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on('error', reject)
      .screenshot({
        timestamps: ['1%'],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x240'
      })
      .on('end', () => resolve(path.basename(outputPath)));;
  });
};

// configure multer storage for different types
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/music'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/videos'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/images'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const projectStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/projects'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

// configure upload helpers using fields when multiple file inputs are needed
const uploadMusic = multer({ storage: musicStorage });
const uploadVideo = multer({ storage: videoStorage });
const uploadImage = multer({ storage: imageStorage });
const uploadProject = multer({ storage: projectStorage });

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/documents'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const uploadDocument = multer({ storage: documentStorage });
const uploadDocumentFields = multer({ storage: documentStorage }).fields([
  { name: 'documents', maxCount: 10 }
]);

// for forms with more than one file field we use .fields()
const uploadMusicFields = multer({ storage: musicStorage }).fields([
  { name: 'file', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);
const uploadBatchMusic = multer({ storage: musicStorage }).fields([
  { name: 'files', maxCount: 50 },
  { name: 'shared_cover', maxCount: 1 }
]);
const uploadVideoFields = multer({ storage: videoStorage }).fields([
  { name: 'file', maxCount: 1 }
]);

// Project forms: combined middleware to handle both hero_image and documents in one request
const uploadProjectCreate = multer({ storage: projectStorage }).fields([
  { name: 'hero_image', maxCount: 1 }
]);
const uploadProjectWithDocs = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'hero_image') {
        cb(null, 'uploads/projects');
      } else if (file.fieldname === 'documents') {
        cb(null, 'uploads/documents');
      }
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  })
}).fields([
  { name: 'hero_image', maxCount: 1 },
  { name: 'documents', maxCount: 10 }
]);

const uploadUpdateWithDocs = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'documents') {
        cb(null, 'uploads/documents');
      }
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  })
}).fields([
  { name: 'documents', maxCount: 10 }
]);


// dashboard overview
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const counts = {};
  counts.music = (await db.get('SELECT COUNT(*) as c FROM music')).c;
  counts.videos = (await db.get('SELECT COUNT(*) as c FROM videos')).c;
  counts.gallery = (await db.get('SELECT COUNT(*) as c FROM gallery')).c;
  counts.projects = (await db.get('SELECT COUNT(*) as c FROM projects')).c;
  res.render('admin/dashboard', { counts });
});

// music management
router.get('/music', async (req, res) => {
  const db = req.app.locals.db;
  const tracks = await db.all('SELECT * FROM music ORDER BY order_index, id');
  const playlists = await db.all('SELECT id, title FROM music_playlists ORDER BY title');
  // build map of track->playlist titles
  const mapping = {};
  const rows = await db.all('SELECT mpi.music_id, mp.id as pid, mp.title FROM music_playlist_items mpi JOIN music_playlists mp ON mp.id = mpi.playlist_id');
  rows.forEach(r => {
    if (!mapping[r.music_id]) mapping[r.music_id] = [];
    mapping[r.music_id].push({ id: r.pid, title: r.title });
  });
  res.render('admin/music/index', { tracks, playlists, trackPlaylists: mapping });
});

router.get('/music/new', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT id, title FROM music_playlists ORDER BY title');
  res.render('admin/music/new', { playlists });
});

router.post('/music', uploadMusicFields, async (req, res) => {
  const db = req.app.locals.db;
  const { title, artist, album, year, description, order_index, playlists } = req.body;
  const filename = req.files && req.files.file ? req.files.file[0].filename : '';
  const cover = req.files && req.files.cover ? req.files.cover[0].filename : '';
  const result = await db.run(
    'INSERT INTO music (title, artist, album, year, description, filename, cover_image, order_index) VALUES (?,?,?,?,?,?,?,?)',
    title, artist, album, year, description, filename, cover, order_index || null
  );
  const musicId = result.lastID;
  // if playlists were selected, add entries
  if (musicId && playlists) {
    const arr = Array.isArray(playlists) ? playlists : [playlists];
    for (const pid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM music_playlist_items WHERE playlist_id = ?', pid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT OR IGNORE INTO music_playlist_items (playlist_id, music_id, order_index) VALUES (?,?,?)', pid, musicId, nextOrder);
    }
  }
  req.flash('success', 'Music uploaded');
  res.redirect('/admin/music');
});

// batch music upload
router.get('/music/batch', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT id, title FROM music_playlists ORDER BY title');
  res.render('admin/music/batch', { playlists });
});

router.post('/music/batch', uploadBatchMusic, async (req, res) => {
  const db = req.app.locals.db;
  const { default_artist, default_album, default_year, shared_description, playlist_id, new_playlist_title } = req.body;
  const files = req.files.files || [];
  const sharedCoverFile = req.files.shared_cover ? req.files.shared_cover[0] : null;

  let targetPlaylistId = playlist_id;
  if (new_playlist_title && new_playlist_title.trim()) {
    const result = await db.run('INSERT INTO music_playlists (title, description) VALUES (?, ?)', new_playlist_title.trim(), shared_description || null);
    targetPlaylistId = result.lastID;
  }

  const uploadedTracks = [];

  for (const file of files) {
    const filePath = path.join('uploads/music', file.filename);
    let metadata = {};
    let coverFilename = sharedCoverFile ? sharedCoverFile.filename : null;

    try {
      const parsed = await mm.parseFile(filePath);
      metadata = {
        title: parsed.common.title,
        artist: parsed.common.artist,
        album: parsed.common.album,
        year: parsed.common.year,
        track: parsed.common.track.no,
        genre: parsed.common.genre ? parsed.common.genre[0] : null
      };
      // extract embedded cover if no shared cover
      if (!coverFilename && parsed.common.picture && parsed.common.picture.length > 0) {
        const pic = parsed.common.picture[0];
        const ext = pic.format.split('/')[1] || 'jpg';
        coverFilename = Date.now() + '_embedded.' + ext;
        const fs = require('fs');
        fs.writeFileSync(path.join('uploads/music', coverFilename), pic.data);
      }
    } catch (err) {
      console.log('Metadata extraction failed for', file.originalname, err.message);
    }

    // fallback to filename if no title
    const title = metadata.title || path.parse(file.originalname).name;
    const artist = metadata.artist || default_artist || null;
    const album = metadata.album || default_album || null;
    const year = metadata.year || default_year || null;
    const order_index = metadata.track || null;

    const result = await db.run(
      'INSERT INTO music (title, artist, album, year, filename, cover_image, order_index) VALUES (?,?,?,?,?,?,?)',
      title, artist, album, year, file.filename, coverFilename, order_index
    );
    const musicId = result.lastID;
    uploadedTracks.push({ id: musicId, title, artist, album, track: metadata.track });

    // assign to playlist if selected
    if (targetPlaylistId) {
      const order = metadata.track || (await db.get('SELECT MAX(order_index) as max_order FROM music_playlist_items WHERE playlist_id = ?', targetPlaylistId)).max_order + 1 || 1;
      await db.run('INSERT OR IGNORE INTO music_playlist_items (playlist_id, music_id, order_index) VALUES (?,?,?)', targetPlaylistId, musicId, order);
    }
  }

  req.flash('success', `Batch uploaded ${files.length} tracks`);
  res.redirect('/admin/music');
});

router.get('/music/:id/edit', async (req, res) => {
  const db = req.app.locals.db;
  const track = await db.get('SELECT * FROM music WHERE id = ?', req.params.id);
  if (!track) return res.redirect('/admin/music');
  const playlists = await db.all('SELECT id, title FROM music_playlists ORDER BY title');
  const existing = await db.all('SELECT playlist_id FROM music_playlist_items WHERE music_id = ?', req.params.id);
  const selected = existing.map(e => e.playlist_id);
  res.render('admin/music/edit', { track, playlists, selectedPlaylists: selected });
});

router.put('/music/:id', uploadMusicFields, async (req, res) => {
  const db = req.app.locals.db;
  const { title, artist, album, year, description, order_index, playlists } = req.body;
  const file = req.files && req.files.file ? req.files.file[0].filename : null;
  const cover = req.files && req.files.cover ? req.files.cover[0].filename : null;
  const track = await db.get('SELECT * FROM music WHERE id = ?', req.params.id);
  
  // Delete old files if they're being replaced
  if (file && track.filename && file !== track.filename) {
    await deleteUploadedFile(track.filename, 'music');
  }
  if (cover && track.cover_image && cover !== track.cover_image) {
    await deleteUploadedFile(track.cover_image, 'music');
  }
  
  const filename = file || track.filename;
  const cover_image = cover || track.cover_image;
  await db.run(
    'UPDATE music SET title=?, artist=?, album=?, year=?, description=?, filename=?, cover_image=?, order_index=? WHERE id=?',
    title, artist, album, year, description, filename, cover_image, order_index || null, req.params.id
  );
  // update playlists: remove old, then add new selection if any
  await db.run('DELETE FROM music_playlist_items WHERE music_id = ?', req.params.id);
  if (playlists) {
    const arr = Array.isArray(playlists) ? playlists : [playlists];
    for (const pid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM music_playlist_items WHERE playlist_id = ?', pid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO music_playlist_items (playlist_id, music_id, order_index) VALUES (?,?,?)', pid, req.params.id, nextOrder);
    }
  }
  req.flash('success', 'Track updated');
  res.redirect('/admin/music');
});

router.delete('/music/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const musicId = parseInt(req.params.id);
    
    // Delete associated files first
    await deleteMusicFiles(db, musicId);
    
    // Then delete DB record (cascades to playlist items)
    await db.run('DELETE FROM music WHERE id = ?', musicId);
    
    req.flash('success', 'Track deleted');
    res.redirect('/admin/music');
  } catch (err) {
    console.error('Music deletion error:', err);
    req.flash('error', 'Failed to delete track');
    res.redirect('/admin/music');
  }
});

// video management
router.get('/videos', async (req, res) => {
  const db = req.app.locals.db;
  const videos = await db.all('SELECT * FROM videos ORDER BY created_at DESC');
  const playlists = await db.all('SELECT id, title FROM video_playlists ORDER BY title');
  const mapping = {};
  const rows = await db.all('SELECT vpi.video_id, vp.id as pid, vp.title FROM video_playlist_items vpi JOIN video_playlists vp ON vp.id = vpi.playlist_id');
  rows.forEach(r => {
    if (!mapping[r.video_id]) mapping[r.video_id] = [];
    mapping[r.video_id].push({ id: r.pid, title: r.title });
  });
  res.render('admin/videos/index', { videos, playlists, videoPlaylists: mapping });
});

router.get('/videos/new', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT id, title FROM video_playlists ORDER BY title');
  res.render('admin/videos/new', { playlists });
});

router.post('/videos', uploadVideoFields, async (req, res) => {
  const db = req.app.locals.db;
  const { title, description, embed_url, category, playlists } = req.body;
  const filename = req.files && req.files.file ? req.files.file[0].filename : null;
  let thumbnail = null;
  
  // generate thumbnail from video if provided
  if (filename) {
    try {
      const videoPath = path.join('uploads/videos', filename);
      const thumbFilename = Date.now() + '.jpg';
      const thumbnailPath = path.join('uploads/videos', thumbFilename);
      await generateVideoThumbnail(videoPath, thumbnailPath);
      thumbnail = thumbFilename;
    } catch (err) {
      console.error('Thumbnail generation failed:', err);
      // continue without thumbnail
    }
  }
  
  const result = await db.run(
    'INSERT INTO videos (title, description, filename, embed_url, thumbnail, category) VALUES (?,?,?,?,?,?)',
    title, description, filename, embed_url, thumbnail, category
  );
  const videoId = result.lastID;
  if (videoId && playlists) {
    const arr = Array.isArray(playlists) ? playlists : [playlists];
    for (const pid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM video_playlist_items WHERE playlist_id = ?', pid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT OR IGNORE INTO video_playlist_items (playlist_id, video_id, order_index) VALUES (?,?,?)', pid, videoId, nextOrder);
    }
  }
  req.flash('success', 'Video added');
  res.redirect('/admin/videos');
});

router.get('/videos/:id/edit', async (req, res) => {
  const db = req.app.locals.db;
  const video = await db.get('SELECT * FROM videos WHERE id = ?', req.params.id);
  if (!video) return res.redirect('/admin/videos');
  const playlists = await db.all('SELECT id, title FROM video_playlists ORDER BY title');
  const existing = await db.all('SELECT playlist_id FROM video_playlist_items WHERE video_id = ?', req.params.id);
  const selected = existing.map(e => e.playlist_id);
  res.render('admin/videos/edit', { video, playlists, selectedPlaylists: selected });
});

router.put('/videos/:id', uploadVideoFields, async (req, res) => {
  const db = req.app.locals.db;
  const { title, description, embed_url, category, playlists } = req.body;
  const file = req.files && req.files.file ? req.files.file[0].filename : null;
  const video = await db.get('SELECT * FROM videos WHERE id = ?', req.params.id);
  
  // Delete old video file if being replaced
  if (file && video.filename && file !== video.filename) {
    await deleteUploadedFile(video.filename, 'videos');
  }
  
  const filename = file || video.filename;
  let thumbnail = video.thumbnail;
  
  // if new video file provided, regenerate thumbnail
  if (file) {
    try {
      const videoPath = path.join('uploads/videos', filename);
      const thumbFilename = Date.now() + '.jpg';
      const thumbnailPath = path.join('uploads/videos', thumbFilename);
      await generateVideoThumbnail(videoPath, thumbnailPath);
      
      // Delete old thumbnail if we generated a new one
      if (thumbnail && thumbnail !== thumbFilename) {
        await deleteUploadedFile(thumbnail, 'videos');
      }
      
      thumbnail = thumbFilename;
    } catch (err) {
      console.error('Thumbnail generation failed:', err);
      // keep existing thumbnail
    }
  }
  
  const cat = category || video.category;
  await db.run(
    'UPDATE videos SET title=?, description=?, filename=?, embed_url=?, thumbnail=?, category=? WHERE id=?',
    title, description, filename, embed_url, thumbnail, cat, req.params.id
  );
  // update playlist items
  await db.run('DELETE FROM video_playlist_items WHERE video_id = ?', req.params.id);
  if (playlists) {
    const arr = Array.isArray(playlists) ? playlists : [playlists];
    for (const pid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM video_playlist_items WHERE playlist_id = ?', pid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO video_playlist_items (playlist_id, video_id, order_index) VALUES (?,?,?)', pid, req.params.id, nextOrder);
    }
  }
  req.flash('success', 'Video updated');
  res.redirect('/admin/videos');
});

router.delete('/videos/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const videoId = parseInt(req.params.id);
    
    // Delete associated files first
    await deleteVideoFiles(db, videoId);
    
    // Then delete DB record (cascades to playlist items)
    await db.run('DELETE FROM videos WHERE id = ?', videoId);
    
    req.flash('success', 'Video deleted');
    res.redirect('/admin/videos');
  } catch (err) {
    console.error('Video deletion error:', err);
    req.flash('error', 'Failed to delete video');
    res.redirect('/admin/videos');
  }
});

// gallery management
router.get('/gallery', async (req, res) => {
  const db = req.app.locals.db;
  const images = await db.all('SELECT * FROM gallery ORDER BY created_at DESC');
  const collections = await db.all('SELECT id, title FROM gallery_collections ORDER BY title');
  const mapping = {};
  const rows = await db.all('SELECT gci.gallery_id, gc.id as cid, gc.title FROM gallery_collection_items gci JOIN gallery_collections gc ON gc.id = gci.collection_id');
  rows.forEach(r => {
    if (!mapping[r.gallery_id]) mapping[r.gallery_id] = [];
    mapping[r.gallery_id].push({ id: r.cid, title: r.title });
  });
  res.render('admin/gallery/index', { images, collections, imageCollections: mapping });
});

router.get('/gallery/new', async (req, res) => {
  const db = req.app.locals.db;
  const collections = await db.all('SELECT id, title FROM gallery_collections ORDER BY title');
  res.render('admin/gallery/new', { collections });
});

router.post('/gallery', uploadImage.single('file'), async (req, res) => {
  const db = req.app.locals.db;
  const { title, caption, category, collections } = req.body;
  const filename = req.file ? req.file.filename : null;
  const result = await db.run(
    'INSERT INTO gallery (title, caption, filename, category) VALUES (?,?,?,?)',
    title, caption, filename, category
  );
  const imageId = result.lastID;
  if (imageId && collections) {
    const arr = Array.isArray(collections) ? collections : [collections];
    for (const cid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM gallery_collection_items WHERE collection_id = ?', cid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT OR IGNORE INTO gallery_collection_items (collection_id, gallery_id, order_index) VALUES (?,?,?)', cid, imageId, nextOrder);
    }
  }
  req.flash('success', 'Image uploaded');
  res.redirect('/admin/gallery');
});

router.get('/gallery/:id/edit', async (req, res) => {
  const db = req.app.locals.db;
  const img = await db.get('SELECT * FROM gallery WHERE id = ?', req.params.id);
  if (!img) return res.redirect('/admin/gallery');
  const collections = await db.all('SELECT id, title FROM gallery_collections ORDER BY title');
  const existing = await db.all('SELECT collection_id FROM gallery_collection_items WHERE gallery_id = ?', req.params.id);
  const selected = existing.map(e => e.collection_id);
  res.render('admin/gallery/edit', { img, collections, collectionIds: selected });
});

router.put('/gallery/:id', uploadImage.single('file'), async (req, res) => {
  const db = req.app.locals.db;
  const { title, caption, category, collections } = req.body;
  const file = req.file ? req.file.filename : null;
  const img = await db.get('SELECT * FROM gallery WHERE id = ?', req.params.id);
  
  // Delete old image file if being replaced
  if (file && img.filename && file !== img.filename) {
    await deleteUploadedFile(img.filename, 'images');
  }
  
  const filename = file || img.filename;
  await db.run(
    'UPDATE gallery SET title=?, caption=?, category=?, filename=? WHERE id=?',
    title, caption, category, filename, req.params.id
  );
  // update collection assignments
  await db.run('DELETE FROM gallery_collection_items WHERE gallery_id = ?', req.params.id);
  if (collections) {
    const arr = Array.isArray(collections) ? collections : [collections];
    for (const cid of arr) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM gallery_collection_items WHERE collection_id = ?', cid);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO gallery_collection_items (collection_id, gallery_id, order_index) VALUES (?,?,?)', cid, req.params.id, nextOrder);
    }
  }
  req.flash('success', 'Image updated');
  res.redirect('/admin/gallery');
});

router.delete('/gallery/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const galleryId = parseInt(req.params.id);
    
    // Delete associated files first
    await deleteGalleryFiles(db, galleryId);
    
    // Then delete DB record (cascades to collection items)
    await db.run('DELETE FROM gallery WHERE id = ?', galleryId);
    
    req.flash('success', 'Image deleted');
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Gallery deletion error:', err);
    req.flash('error', 'Failed to delete image');
    res.redirect('/admin/gallery');
  }
});

// projects management
function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^ -]+/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}
// Ensure slug is unique, appending -2, -3 etc as needed. Optionally ignore a specific project id
async function generateUniqueSlug(db, title, ignoreId = null) {
  const base = slugify(title);
  let slug = base;
  let counter = 1;
  while (true) {
    let query = 'SELECT id FROM projects WHERE slug = ?';
    let params = [slug];
    if (ignoreId) {
      query += ' AND id != ?';
      params.push(ignoreId);
    }
    const existing = await db.get(query, ...params);
    if (!existing) break;
    counter += 1;
    slug = `${base}-${counter}`;
  }
  return slug;
}
router.get('/projects', async (req, res) => {
  const db = req.app.locals.db;
  const projects = await db.all('SELECT * FROM projects ORDER BY created_at DESC');
  const collections = await db.all('SELECT id, title FROM project_collections ORDER BY title');
  const mapping = {};
  const rows = await db.all('SELECT pci.project_id, pc.id as cid, pc.title FROM project_collection_items pci JOIN project_collections pc ON pc.id = pci.collection_id');
  rows.forEach(r => {
    if (!mapping[r.project_id]) mapping[r.project_id] = [];
    mapping[r.project_id].push({ id: r.cid, title: r.title });
  });
  res.render('admin/projects/index', { projects, collections, projectCollections: mapping });
});

router.get('/projects/new', async (req, res) => {
  const db = req.app.locals.db;
  const collections = await db.all('SELECT id, title FROM project_collections ORDER BY title');
  res.render('admin/projects/new', { collections });
});

router.post('/projects', uploadProjectWithDocs, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, summary, description, status, tags } = req.body;
    
    if (!title || title.trim() === '') {
      req.flash('error', 'Project title is required');
      return res.redirect('/admin/projects/new');
    }
    
    const slug = await generateUniqueSlug(db, title);
    const hero = req.files && req.files.hero_image ? req.files.hero_image[0].filename : null;
    
    // Create project
    const result = await db.run(
      'INSERT INTO projects (title, slug, summary, description, status, tags, hero_image) VALUES (?,?,?,?,?,?,?)',
      title, slug, summary, description, status, tags, hero
    );
    const projectId = result.lastID;
    
    // Add documents if provided
    if (projectId && req.files && req.files.documents && Array.isArray(req.files.documents)) {
      for (const file of req.files.documents) {
        await db.run('INSERT INTO project_documents (project_id, filename, original_name) VALUES (?,?,?)', projectId, file.filename, file.originalname);
      }
    }
    // assign to collections if any
    if (projectId && req.body.collections) {
      const arr = Array.isArray(req.body.collections) ? req.body.collections : [req.body.collections];
      for (const cid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM project_collection_items WHERE collection_id = ?', cid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO project_collection_items (collection_id, project_id, order_index) VALUES (?,?,?)', cid, projectId, nextOrder);
      }
    }
    
    req.flash('success', 'Project created');
    res.redirect('/admin/projects');
  } catch (err) {
    console.error('Project creation error:', err);
    req.flash('error', 'Failed to create project: ' + (err.message || 'Unknown error'));
    res.redirect('/admin/projects/new');
  }
});

router.get('/projects/:id/edit', async (req, res) => {
  const db = req.app.locals.db;
  const projId = parseInt(req.params.id);
  const proj = await db.get('SELECT * FROM projects WHERE id = ?', projId);
  if (!proj) return res.redirect('/admin/projects');
  
  const updates = await db.all('SELECT * FROM project_updates WHERE project_id = ? ORDER BY created_at DESC', projId);
  
  // Load attachments for each update
  for (const update of updates) {
    update.attachments = await db.all('SELECT * FROM project_update_attachments WHERE update_id = ?', update.id);
  }
  // fetch collection memberships
  const existingCols = await db.all('SELECT collection_id FROM project_collection_items WHERE project_id = ?', projId);
  const colIds = existingCols.map(r => r.collection_id);
  const collections = await db.all('SELECT id, title FROM project_collections ORDER BY title');
  res.render('admin/projects/edit', { proj, updates, collectionIds: colIds, collections });
});

router.put('/projects/:id', uploadProjectWithDocs, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, summary, description, status, tags } = req.body;
    const projId = parseInt(req.params.id);
    
    if (!title || title.trim() === '') {
      req.flash('error', 'Project title is required');
      return res.redirect(`/admin/projects/${projId}/edit`);
    }
    
    const slug = await generateUniqueSlug(db, title, projId);
    
    // Fetch current project
    const proj = await db.get('SELECT * FROM projects WHERE id = ?', projId);
    if (!proj) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin/projects');
    }
    
    // Handle hero image replacement
    let hero = proj.hero_image;
    if (req.files && req.files.hero_image) {
      const newHero = req.files.hero_image[0].filename;
      // Delete old hero image if being replaced
      if (proj.hero_image && newHero !== proj.hero_image) {
        await deleteUploadedFile(proj.hero_image, 'projects');
      }
      hero = newHero;
    }
    
    // Update project
    await db.run(
      'UPDATE projects SET title=?, slug=?, summary=?, description=?, status=?, tags=?, hero_image=? WHERE id=?',
      title, slug, summary, description, status, tags, hero, projId
    );
    
    // Add new documents if provided
    if (req.files && req.files.documents && Array.isArray(req.files.documents)) {
      for (const file of req.files.documents) {
        await db.run('INSERT INTO project_documents (project_id, filename, original_name) VALUES (?,?,?)', projId, file.filename, file.originalname);
      }
    }
    // update collection assignments: clear then re-add
    await db.run('DELETE FROM project_collection_items WHERE project_id = ?', projId);
    if (req.body.collections) {
      const arr = Array.isArray(req.body.collections) ? req.body.collections : [req.body.collections];
      for (const cid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM project_collection_items WHERE collection_id = ?', cid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO project_collection_items (collection_id, project_id, order_index) VALUES (?,?,?)', cid, projId, nextOrder);
      }
    }
    
    req.flash('success', 'Project updated');
    res.redirect('/admin/projects');
  } catch (err) {
    console.error('Project update error:', err);
    req.flash('error', 'Failed to update project: ' + (err.message || 'Unknown error'));
    res.redirect(`/admin/projects/${req.params.id}/edit`);
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const projId = parseInt(req.params.id);
    
    // Verify project exists
    const proj = await db.get('SELECT id FROM projects WHERE id = ?', projId);
    if (!proj) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin/projects');
    }
    
    // Delete all associated files (hero, documents, update attachments)
    await deleteProjectFiles(db, projId);
    
    // Delete cascades to project_updates and project_documents via FK
    await db.run('DELETE FROM projects WHERE id = ?', projId);
    
    req.flash('success', 'Project deleted');
    res.redirect('/admin/projects');
  } catch (err) {
    console.error('Project deletion error:', err);
    req.flash('error', 'Failed to delete project: ' + (err.message || 'Unknown error'));
    res.redirect('/admin/projects');
  }
});

// project updates
router.post('/projects/:id/updates', uploadUpdateWithDocs, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { content } = req.body;
    const projId = parseInt(req.params.id);
    
    // Validate project exists
    const proj = await db.get('SELECT id FROM projects WHERE id = ?', projId);
    if (!proj) {
      req.flash('error', 'Project not found');
      return res.redirect('/admin/projects');
    }
    
    // Validate content
    if (!content || content.trim() === '') {
      req.flash('error', 'Update content cannot be empty');
      return res.redirect(`/admin/projects/${projId}/edit`);
    }
    
    // Create update first
    const result = await db.run('INSERT INTO project_updates (project_id, content) VALUES (?,?)', projId, content);
    const updateId = result.lastID;
    
    // Then add attachments if files were provided
    if (updateId && req.files && req.files.documents && Array.isArray(req.files.documents)) {
      for (const file of req.files.documents) {
        await db.run('INSERT INTO project_update_attachments (update_id, filename, original_name) VALUES (?,?,?)', updateId, file.filename, file.originalname);
      }
    }
    
    req.flash('success', 'Update added');
    res.redirect(`/admin/projects/${projId}/edit`);
  } catch (err) {
    console.error('Project update creation error:', err);
    req.flash('error', 'Failed to add update: ' + (err.message || 'Unknown error'));
    res.redirect(`/admin/projects/${req.params.id}/edit`);
  }
});

router.delete('/projects/:projId/updates/:updateId', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const updateId = parseInt(req.params.updateId);
    const projId = parseInt(req.params.projId);
    
    // Verify update belongs to project
    const update = await db.get('SELECT * FROM project_updates WHERE id = ? AND project_id = ?', updateId, projId);
    if (!update) {
      req.flash('error', 'Update not found');
      return res.redirect(`/admin/projects/${projId}/edit`);
    }
    
    // Delete attachment files first
    await deleteProjectUpdateFiles(db, updateId);
    
    // Delete attachment DB records
    await db.run('DELETE FROM project_update_attachments WHERE update_id = ?', updateId);
    
    // Then delete the update
    await db.run('DELETE FROM project_updates WHERE id = ?', updateId);
    
    req.flash('success', 'Update removed');
    res.redirect(`/admin/projects/${projId}/edit`);
  } catch (err) {
    console.error('Project update deletion error:', err);
    req.flash('error', 'Failed to remove update: ' + (err.message || 'Unknown error'));
    res.redirect(`/admin/projects/${req.params.projId}/edit`);
  }
});

// music playlists
router.get('/playlists/music', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT * FROM music_playlists ORDER BY created_at DESC');
  res.render('admin/playlists/music', { playlists });
});

router.post('/playlists/music', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Playlist title is required');
      return res.redirect('/admin/playlists/music');
    }
    await db.run('INSERT INTO music_playlists (title, description) VALUES (?,?)', title, description);
    req.flash('success', 'Playlist created');
    res.redirect('/admin/playlists/music');
  } catch (err) {
    console.error('Playlist creation error:', err);
    req.flash('error', 'Failed to create playlist');
    res.redirect('/admin/playlists/music');
  }
});

router.get('/playlists/music/:id/edit', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const playlist = await db.get('SELECT * FROM music_playlists WHERE id = ?', req.params.id);
    if (!playlist) {
      req.flash('error', 'Playlist not found');
      return res.redirect('/admin/playlists/music');
    }
    res.render('admin/playlists/edit', { playlist });
  } catch (err) {
    console.error('Playlist edit error:', err);
    req.flash('error', 'Failed to load playlist');
    res.redirect('/admin/playlists/music');
  }
});

router.put('/playlists/music/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Playlist title is required');
      return res.redirect('/admin/playlists/music');
    }
    await db.run('UPDATE music_playlists SET title=?, description=? WHERE id=?', title, description, req.params.id);
    req.flash('success', 'Playlist updated');
    res.redirect('/admin/playlists/music');
  } catch (err) {
    console.error('Playlist update error:', err);
    req.flash('error', 'Failed to update playlist');
    res.redirect('/admin/playlists/music');
  }
});

router.get('/playlists/music/:id/tracks', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const playlist = await db.get('SELECT * FROM music_playlists WHERE id = ?', req.params.id);
    if (!playlist) {
      req.flash('error', 'Playlist not found');
      return res.redirect('/admin/playlists/music');
    }
    const tracks = await db.all(`
      SELECT m.*, mpi.order_index, mpi.id as mpi_id
      FROM music m
      JOIN music_playlist_items mpi ON mpi.music_id = m.id
      WHERE mpi.playlist_id = ?
      ORDER BY mpi.order_index, m.id
    `, req.params.id);
    res.render('admin/playlists/tracks', { playlist, tracks });
  } catch (err) {
    console.error('Playlist tracks error:', err);
    req.flash('error', 'Failed to load playlist tracks');
    res.redirect('/admin/playlists/music');
  }
});

router.post('/playlists/music/:id/order', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const playlistId = parseInt(req.params.id, 10);
    if (Number.isNaN(playlistId)) {
      req.flash('error', 'Invalid playlist id');
      return res.redirect('/admin/playlists/music');
    }

    const currentRows = await db.all(
      `SELECT music_id, order_index
       FROM music_playlist_items
       WHERE playlist_id = ?
       ORDER BY order_index, music_id`,
      playlistId
    );

    if (!currentRows.length) {
      req.flash('info', 'No tracks to reorder in this playlist');
      return res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
    }

    const trackIdsRaw = req.body.track_ids || [];
    const orderValuesRaw = req.body.order_values || [];
    const trackIds = Array.isArray(trackIdsRaw) ? trackIdsRaw : [trackIdsRaw];
    const orderValues = Array.isArray(orderValuesRaw) ? orderValuesRaw : [orderValuesRaw];

    const requestedOrderByTrack = new Map();
    trackIds.forEach((id, idx) => {
      const parsedTrackId = parseInt(id, 10);
      const parsedOrder = parseInt(orderValues[idx], 10);
      if (!Number.isNaN(parsedTrackId)) {
        const safeOrder = Number.isNaN(parsedOrder) || parsedOrder < 1 ? null : parsedOrder;
        requestedOrderByTrack.set(parsedTrackId, safeOrder);
      }
    });

    // Deterministic conflict resolution:
    // 1) requested numeric order ascending
    // 2) current order ascending
    // 3) music_id ascending
    const normalized = currentRows
      .map((row, idx) => ({
        music_id: row.music_id,
        current_order: row.order_index == null ? idx + 1 : row.order_index,
        requested_order: requestedOrderByTrack.has(row.music_id)
          ? requestedOrderByTrack.get(row.music_id)
          : null,
      }))
      .sort((a, b) => {
        const aReq = a.requested_order == null ? Number.MAX_SAFE_INTEGER : a.requested_order;
        const bReq = b.requested_order == null ? Number.MAX_SAFE_INTEGER : b.requested_order;
        if (aReq !== bReq) return aReq - bReq;
        if (a.current_order !== b.current_order) return a.current_order - b.current_order;
        return a.music_id - b.music_id;
      });

    await db.exec('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < normalized.length; i += 1) {
        await db.run(
          'UPDATE music_playlist_items SET order_index = ? WHERE playlist_id = ? AND music_id = ?',
          i + 1,
          playlistId,
          normalized[i].music_id
        );
      }
      await db.exec('COMMIT');
    } catch (txErr) {
      await db.exec('ROLLBACK');
      throw txErr;
    }

    req.flash('success', 'Playlist order saved');
    return res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
  } catch (err) {
    console.error('Save playlist order error:', err);
    req.flash('error', 'Failed to save playlist order');
    return res.redirect(`/admin/playlists/music/${req.params.id}/tracks`);
  }
});

router.post('/playlists/music/:id/move', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { track_id, direction } = req.body;
    const playlistId = parseInt(req.params.id);
    const trackId = parseInt(track_id);
    
    // Get current order of this track
    const current = await db.get(
      'SELECT order_index FROM music_playlist_items WHERE playlist_id = ? AND music_id = ?',
      playlistId, trackId
    );
    if (!current) {
      req.flash('error', 'Track not found in playlist');
      return res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
    }
    
    const currentOrder = current.order_index;
    let newOrder;
    
    if (direction === 'up') {
      // Find the track with order_index just below current
      const swapTrack = await db.get(`
        SELECT music_id, order_index FROM music_playlist_items
        WHERE playlist_id = ? AND order_index < ?
        ORDER BY order_index DESC LIMIT 1
      `, playlistId, currentOrder);
      if (!swapTrack) {
        req.flash('error', 'Cannot move up - already at top');
        return res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
      }
      newOrder = swapTrack.order_index;
      // Swap order indices
      await db.run(
        'UPDATE music_playlist_items SET order_index = ? WHERE playlist_id = ? AND music_id = ?',
        swapTrack.order_index, playlistId, trackId
      );
      await db.run(
        'UPDATE music_playlist_items SET order_index = ? WHERE playlist_id = ? AND music_id = ?',
        currentOrder, playlistId, swapTrack.music_id
      );
    } else if (direction === 'down') {
      // Find the track with order_index just above current
      const swapTrack = await db.get(`
        SELECT music_id, order_index FROM music_playlist_items
        WHERE playlist_id = ? AND order_index > ?
        ORDER BY order_index ASC LIMIT 1
      `, playlistId, currentOrder);
      if (!swapTrack) {
        req.flash('error', 'Cannot move down - already at bottom');
        return res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
      }
      newOrder = swapTrack.order_index;
      // Swap order indices
      await db.run(
        'UPDATE music_playlist_items SET order_index = ? WHERE playlist_id = ? AND music_id = ?',
        swapTrack.order_index, playlistId, trackId
      );
      await db.run(
        'UPDATE music_playlist_items SET order_index = ? WHERE playlist_id = ? AND music_id = ?',
        currentOrder, playlistId, swapTrack.music_id
      );
    }
    
    req.flash('success', 'Track order updated');
    res.redirect(`/admin/playlists/music/${playlistId}/tracks`);
  } catch (err) {
    console.error('Move track error:', err);
    req.flash('error', 'Failed to move track');
    res.redirect(`/admin/playlists/music/${req.params.id}/tracks`);
  }
});

router.delete('/playlists/music/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.run('DELETE FROM music_playlists WHERE id = ?', req.params.id);
    req.flash('success', 'Playlist deleted');
    res.redirect('/admin/playlists/music');
  } catch (err) {
    console.error('Playlist deletion error:', err);
    req.flash('error', 'Failed to delete playlist');
    res.redirect('/admin/playlists/music');
  }
});

// add music to playlist (legacy add-only, avoids duplicates)
router.post('/playlists/music/add', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { playlist_id, music_id } = req.body;
    // prevent duplicate membership
    const exists = await db.get('SELECT 1 FROM music_playlist_items WHERE playlist_id=? AND music_id=?', playlist_id, music_id);
    if (!exists) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM music_playlist_items WHERE playlist_id = ?', playlist_id);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO music_playlist_items (playlist_id, music_id, order_index) VALUES (?,?,?)', playlist_id, music_id, nextOrder);
      req.flash('success', 'Track added to playlist');
    } else {
      req.flash('info', 'Track already in that playlist');
    }
    res.redirect('/admin/music');
  } catch (err) {
    console.error('Add to playlist error:', err);
    req.flash('error', 'Failed to add track');
    res.redirect('/admin/music');
  }
});

// manage playlists for a specific track
router.post('/music/:id/playlists', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const trackId = parseInt(req.params.id);
    // clear existing memberships
    await db.run('DELETE FROM music_playlist_items WHERE music_id = ?', trackId);
    const playlists = req.body.playlists;
    if (playlists) {
      const arr = Array.isArray(playlists) ? playlists : [playlists];
      for (const pid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM music_playlist_items WHERE playlist_id = ?', pid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO music_playlist_items (playlist_id, music_id, order_index) VALUES (?,?,?)', pid, trackId, nextOrder);
      }
    }
    req.flash('success', 'Playlist assignments updated');
    res.redirect('/admin/music');
  } catch (err) {
    console.error('Update track playlists error:', err);
    req.flash('error', 'Failed to update playlists');
    res.redirect('/admin/music');
  }
});

// video playlists
router.get('/playlists/videos', async (req, res) => {
  const db = req.app.locals.db;
  const playlists = await db.all('SELECT * FROM video_playlists ORDER BY created_at DESC');
  res.render('admin/playlists/videos', { playlists });
});

router.post('/playlists/videos', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Playlist title is required');
      return res.redirect('/admin/playlists/videos');
    }
    await db.run('INSERT INTO video_playlists (title, description) VALUES (?,?)', title, description);
    req.flash('success', 'Playlist created');
    res.redirect('/admin/playlists/videos');
  } catch (err) {
    console.error('Playlist creation error:', err);
    req.flash('error', 'Failed to create playlist');
    res.redirect('/admin/playlists/videos');
  }
});

router.put('/playlists/videos/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Playlist title is required');
      return res.redirect('/admin/playlists/videos');
    }
    await db.run('UPDATE video_playlists SET title=?, description=? WHERE id=?', title, description, req.params.id);
    req.flash('success', 'Playlist updated');
    res.redirect('/admin/playlists/videos');
  } catch (err) {
    console.error('Playlist update error:', err);
    req.flash('error', 'Failed to update playlist');
    res.redirect('/admin/playlists/videos');
  }
});

router.delete('/playlists/videos/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.run('DELETE FROM video_playlists WHERE id = ?', req.params.id);
    req.flash('success', 'Playlist deleted');
    res.redirect('/admin/playlists/videos');
  } catch (err) {
    console.error('Playlist deletion error:', err);
    req.flash('error', 'Failed to delete playlist');
    res.redirect('/admin/playlists/videos');
  }
});

// add video to playlist via parameters
router.post('/playlists/videos/:id/add/:videoId', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const playlistId = parseInt(req.params.id);
    const videoId = parseInt(req.params.videoId);
    const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM video_playlist_items WHERE playlist_id = ?', playlistId);
    const nextOrder = (maxOrder.max_order || 0) + 1;
    await db.run('INSERT INTO video_playlist_items (playlist_id, video_id, order_index) VALUES (?,?,?)', playlistId, videoId, nextOrder);
    req.flash('success', 'Video added to playlist');
    res.redirect('/admin/playlists/videos');
  } catch (err) {
    console.error('Add to playlist error:', err);
    req.flash('error', 'Failed to add video');
    res.redirect('/admin/playlists/videos');
  }
});

// add video to playlist via form (legacy, avoid duplicates)
router.post('/playlists/videos/add', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { playlist_id, video_id } = req.body;
    const exists = await db.get('SELECT 1 FROM video_playlist_items WHERE playlist_id=? AND video_id=?', playlist_id, video_id);
    if (!exists) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM video_playlist_items WHERE playlist_id = ?', playlist_id);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO video_playlist_items (playlist_id, video_id, order_index) VALUES (?,?,?)', playlist_id, video_id, nextOrder);
      req.flash('success', 'Video added to playlist');
    } else {
      req.flash('info', 'Video already in that playlist');
    }
    res.redirect('/admin/videos');
  } catch (err) {
    console.error('Add to playlist error:', err);
    req.flash('error', 'Failed to add video');
    res.redirect('/admin/videos');
  }
});

// manage playlists for a specific video
router.post('/videos/:id/playlists', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const videoId = parseInt(req.params.id);
    await db.run('DELETE FROM video_playlist_items WHERE video_id = ?', videoId);
    const playlists = req.body.playlists;
    if (playlists) {
      const arr = Array.isArray(playlists) ? playlists : [playlists];
      for (const pid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM video_playlist_items WHERE playlist_id = ?', pid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO video_playlist_items (playlist_id, video_id, order_index) VALUES (?,?,?)', pid, videoId, nextOrder);
      }
    }
    req.flash('success', 'Playlist assignments updated');
    res.redirect('/admin/videos');
  } catch (err) {
    console.error('Update video playlists error:', err);
    req.flash('error', 'Failed to update playlists');
    res.redirect('/admin/videos');
  }
});

// legacy add gallery item to collection
router.post('/collections/gallery/add', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { collection_id, gallery_id } = req.body;
    const exists = await db.get('SELECT 1 FROM gallery_collection_items WHERE collection_id=? AND gallery_id=?', collection_id, gallery_id);
    if (!exists) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM gallery_collection_items WHERE collection_id = ?', collection_id);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT INTO gallery_collection_items (collection_id, gallery_id, order_index) VALUES (?,?,?)', collection_id, gallery_id, nextOrder);
      req.flash('success', 'Image added to collection');
    } else {
      req.flash('info', 'Image already in that collection');
    }
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Add to collection error:', err);
    req.flash('error', 'Failed to add image');
    res.redirect('/admin/gallery');
  }
});

// manage collections for a specific gallery image
router.post('/gallery/:id/collections', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const imgId = parseInt(req.params.id);
    await db.run('DELETE FROM gallery_collection_items WHERE gallery_id = ?', imgId);
    const collections = req.body.collections;
    if (collections) {
      const arr = Array.isArray(collections) ? collections : [collections];
      for (const cid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM gallery_collection_items WHERE collection_id = ?', cid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO gallery_collection_items (collection_id, gallery_id, order_index) VALUES (?,?,?)', cid, imgId, nextOrder);
      }
    }
    req.flash('success', 'Collection assignments updated');
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Update image collections error:', err);
    req.flash('error', 'Failed to update collections');
    res.redirect('/admin/gallery');
  }
});

// manage collections for a specific project
router.post('/projects/:id/collections', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const projId = parseInt(req.params.id);
    await db.run('DELETE FROM project_collection_items WHERE project_id = ?', projId);
    const collections = req.body.collections;
    if (collections) {
      const arr = Array.isArray(collections) ? collections : [collections];
      for (const cid of arr) {
        const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM project_collection_items WHERE collection_id = ?', cid);
        const nextOrder = (maxOrder.max_order || 0) + 1;
        await db.run('INSERT OR IGNORE INTO project_collection_items (collection_id, project_id, order_index) VALUES (?,?,?)', cid, projId, nextOrder);
      }
    }
    req.flash('success', 'Collection assignments updated');
    res.redirect('/admin/projects');
  } catch (err) {
    console.error('Update project collections error:', err);
    req.flash('error', 'Failed to update collections');
    res.redirect('/admin/projects');
  }
});

// gallery collections
router.get('/collections/gallery', async (req, res) => {
  const db = req.app.locals.db;
  const collections = await db.all('SELECT * FROM gallery_collections ORDER BY created_at DESC');
  res.render('admin/collections/gallery', { collections });
});

router.post('/collections/gallery', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Collection title is required');
      return res.redirect('/admin/collections/gallery');
    }
    await db.run('INSERT INTO gallery_collections (title, description) VALUES (?,?)', title, description);
    req.flash('success', 'Collection created');
    res.redirect('/admin/collections/gallery');
  } catch (err) {
    console.error('Collection creation error:', err);
    req.flash('error', 'Failed to create collection');
    res.redirect('/admin/collections/gallery');
  }
});

router.delete('/collections/gallery/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.run('DELETE FROM gallery_collections WHERE id = ?', req.params.id);
    req.flash('success', 'Collection deleted');
    res.redirect('/admin/collections/gallery');
  } catch (err) {
    console.error('Collection deletion error:', err);
    req.flash('error', 'Failed to delete collection');
    res.redirect('/admin/collections/gallery');
  }
});

// gallery collections
router.post('/collections/gallery/add', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { collection_id, gallery_id } = req.body;
    const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM gallery_collection_items WHERE collection_id = ?', collection_id);
    const nextOrder = (maxOrder.max_order || 0) + 1;
    await db.run('INSERT INTO gallery_collection_items (collection_id, gallery_id, order_index) VALUES (?,?,?)', collection_id, gallery_id, nextOrder);
    req.flash('success', 'Image added to collection');
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Add to collection error:', err);
    req.flash('error', 'Failed to add image');
    res.redirect('/admin/gallery');
  }
});

// project collections
router.post('/collections/projects/add', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { collection_id, project_id } = req.body;
    const exists = await db.get('SELECT 1 FROM project_collection_items WHERE collection_id = ? AND project_id = ?', collection_id, project_id);
    if (!exists) {
      const maxOrder = await db.get('SELECT MAX(order_index) as max_order FROM project_collection_items WHERE collection_id = ?', collection_id);
      const nextOrder = (maxOrder.max_order || 0) + 1;
      await db.run('INSERT OR IGNORE INTO project_collection_items (collection_id, project_id, order_index) VALUES (?,?,?)', collection_id, project_id, nextOrder);
      req.flash('success', 'Project added to collection');
    } else {
      req.flash('info', 'Project already in that collection');
    }
    res.redirect('/admin/projects');
  } catch (err) {
    console.error('Add to collection error:', err);
    req.flash('error', 'Failed to add project');
    res.redirect('/admin/projects');
  }
});
router.get('/collections/projects', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const collections = await db.all(`
      SELECT pc.*, COUNT(pci.project_id) AS item_count
      FROM project_collections pc
      LEFT JOIN project_collection_items pci ON pci.collection_id = pc.id
      GROUP BY pc.id
      ORDER BY pc.created_at DESC
    `);
    res.render('admin/collections/projects', { collections });
  } catch (err) {
    console.error('Project collections load error:', err);
    req.flash('error', 'Failed to load project collections');
    res.render('admin/collections/projects', { collections: [] });
  }
});

router.get('/collections/projects/:id/edit', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const collection = await db.get('SELECT * FROM project_collections WHERE id = ?', req.params.id);
    if (!collection) {
      req.flash('error', 'Collection not found');
      return res.redirect('/admin/collections/projects');
    }
    return res.render('admin/collections/project_edit', { collection });
  } catch (err) {
    console.error('Project collection edit load error:', err);
    req.flash('error', 'Failed to load collection');
    return res.redirect('/admin/collections/projects');
  }
});

router.put('/collections/projects/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Collection title is required');
      return res.redirect(`/admin/collections/projects/${req.params.id}/edit`);
    }
    await db.run('UPDATE project_collections SET title = ?, description = ? WHERE id = ?', title.trim(), description || null, req.params.id);
    req.flash('success', 'Collection updated');
    return res.redirect('/admin/collections/projects');
  } catch (err) {
    console.error('Project collection update error:', err);
    req.flash('error', 'Failed to update collection');
    return res.redirect('/admin/collections/projects');
  }
});

router.post('/collections/projects', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { title, description } = req.body;
    if (!title || title.trim() === '') {
      req.flash('error', 'Collection title is required');
      return res.redirect('/admin/collections/projects');
    }
    await db.run('INSERT INTO project_collections (title, description) VALUES (?,?)', title, description);
    req.flash('success', 'Collection created');
    res.redirect('/admin/collections/projects');
  } catch (err) {
    console.error('Collection creation error:', err);
    req.flash('error', 'Failed to create collection');
    res.redirect('/admin/collections/projects');
  }
});

router.delete('/collections/projects/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.run('DELETE FROM project_collections WHERE id = ?', req.params.id);
    req.flash('success', 'Collection deleted');
    res.redirect('/admin/collections/projects');
  } catch (err) {
    console.error('Collection deletion error:', err);
    req.flash('error', 'Failed to delete collection');
    res.redirect('/admin/collections/projects');
  }
});

// logout route if not in auth
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ============================================================================
// PASSWORD CHANGE
// ============================================================================

// GET change password page
router.get('/change-password', (req, res) => {
  res.render('admin/change-password');
});

// POST change password
router.post('/change-password', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Get current admin from session
    if (!req.session || !req.session.admin) {
      req.flash('error', 'Session expired. Please log in again.');
      return res.redirect('/login');
    }
    
    const adminId = req.session.admin.id;
    const admin = await db.get('SELECT * FROM admins WHERE id = ?', adminId);
    
    if (!admin) {
      req.flash('error', 'Admin account not found.');
      return res.redirect('/admin');
    }
    
    // Validate current password
    const currentPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    if (!currentPasswordValid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/admin/change-password');
    }
    
    // Validate new password is not empty
    if (!newPassword || newPassword.trim() === '') {
      req.flash('error', 'New password cannot be empty.');
      return res.redirect('/admin/change-password');
    }
    
    // Validate minimum password length
    if (newPassword.length < 8) {
      req.flash('error', 'New password must be at least 8 characters long.');
      return res.redirect('/admin/change-password');
    }
    
    // Validate new password and confirm password match
    if (newPassword !== confirmPassword) {
      req.flash('error', 'New password and confirmation do not match.');
      return res.redirect('/admin/change-password');
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password in database
    await db.run('UPDATE admins SET password = ? WHERE id = ?', hashedPassword, adminId);
    
    // Success - user remains logged in
    req.flash('success', 'Password changed successfully.');
    res.redirect('/admin');
    
  } catch (err) {
    console.error('Password change error:', err);
    req.flash('error', 'Failed to change password. Please try again.');
    res.redirect('/admin/change-password');
  }
});

module.exports = router;