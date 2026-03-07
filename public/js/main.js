let wavesurfer;
let tracks = []; // DOM elements on /music page for visual sync
let queue = []; // serializable track metadata {filename, title, id} - persists across pages
let currentTrackIndex = -1;
let currentTrackFilename = null;
let queueSource = null; // { type: 'playlist'|'all', playlistId: null|number, search: null|string }
let autoplayEnabled = localStorage.getItem('musicAutoplay') === 'true';
let isPlayerReady = false;
let isScrubbing = false;
let hasRestoredFromStorage = false;
let saveTimer = null;
const PLAYER_STATE_KEY = 'paracausalPlayerState.v2';

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getPlayerEls() {
  return {
    playPauseBtn: document.getElementById('play-pause'),
    prevBtn: document.getElementById('prev'),
    nextBtn: document.getElementById('next'),
    volumeSlider: document.getElementById('volume'),
    currentTimeSpan: document.getElementById('current-time'),
    durationSpan: document.getElementById('duration'),
    nowPlaying: document.getElementById('now-playing'),
    autoplayCheckbox: document.getElementById('autoplay'),
    waveformEl: document.getElementById('waveform')
  };
}

function getNowPlayingText() {
  const { nowPlaying } = getPlayerEls();
  return nowPlaying ? (nowPlaying.textContent || '').trim() : '';
}

function queueSavePlayerState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(savePlayerState, 120);
}

function savePlayerState() {
  if (!wavesurfer) return;

  const { volumeSlider } = getPlayerEls();
  const volume = wavesurfer.getVolume ? wavesurfer.getVolume() : parseFloat(volumeSlider ? volumeSlider.value : '0.5');
  const currentTime = isPlayerReady ? wavesurfer.getCurrentTime() : 0;

  const state = {
    filename: currentTrackFilename,
    title: getNowPlayingText(),
    currentTime: Number.isFinite(currentTime) ? currentTime : 0,
    wasPlaying: !!(wavesurfer.isPlaying && wavesurfer.isPlaying()),
    volume: Number.isFinite(volume) ? volume : 0.5,
    autoplayEnabled: !!autoplayEnabled,
    trackIndex: currentTrackIndex,
    queue: queue.slice(), // save the full queue
    queueSource: queueSource, // save queue context
    pagePath: window.location.pathname,
    pageSearch: window.location.search,
    savedAt: Date.now()
  };

  localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(state));
}

function loadPlayerState() {
  try {
    const raw = localStorage.getItem(PLAYER_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.filename) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

/**
 * Validate if a track file still exists on the server
 * @param {string} filename - The track filename to check
 * @returns {Promise<boolean>} - true if track exists, false otherwise
 */
async function validateTrackExists(filename) {
  if (!filename) return false;
  
  try {
    const response = await fetch(`/uploads/music/${filename}`, {
      method: 'HEAD',
      cache: 'no-cache'
    });
    return response.ok; // 200-299 status codes
  } catch (err) {
    console.warn(`Track validation failed for ${filename}:`, err.message);
    return false;
  }
}

/**
 * Filter queue to remove deleted/missing tracks
 * @param {Array} queueToValidate - Queue array to validate
 * @returns {Promise<Array>} - Filtered queue with only valid tracks
 */
async function filterValidTracks(queueToValidate) {
  if (!Array.isArray(queueToValidate) || queueToValidate.length === 0) {
    return [];
  }
  
  const validatedQueue = [];
  
  for (const track of queueToValidate) {
    if (!track || !track.filename) continue;
    
    const exists = await validateTrackExists(track.filename);
    if (exists) {
      validatedQueue.push(track);
    } else {
      console.log(`Removed deleted track from queue: ${track.title || track.filename}`);
    }
  }
  
  return validatedQueue;
}

async function restorePlayerStateIfNeeded() {
  if (!wavesurfer || hasRestoredFromStorage) return;
  hasRestoredFromStorage = true;

  const state = loadPlayerState();
  if (!state || !state.filename) return;

  const {
    volumeSlider,
    autoplayCheckbox,
    nowPlaying,
    currentTimeSpan,
    durationSpan
  } = getPlayerEls();

  // Restore volume
  if (Number.isFinite(state.volume)) {
    const clampedVolume = Math.min(1, Math.max(0, state.volume));
    if (volumeSlider) volumeSlider.value = clampedVolume;
    wavesurfer.setVolume(clampedVolume);
  }

  // Restore autoplay
  autoplayEnabled = !!state.autoplayEnabled;
  localStorage.setItem('musicAutoplay', autoplayEnabled ? 'true' : 'false');
  if (autoplayCheckbox) autoplayCheckbox.checked = autoplayEnabled;

  // Validate and restore queue - filter out deleted tracks
  let validatedQueue = [];
  if (Array.isArray(state.queue) && state.queue.length > 0) {
    console.log(`Validating ${state.queue.length} tracks in saved queue...`);
    validatedQueue = await filterValidTracks(state.queue);
    console.log(`Queue validation complete: ${validatedQueue.length} valid tracks`);
    
    if (validatedQueue.length > 0) {
      queue = validatedQueue;
      queueSource = state.queueSource || null;
    } else {
      // All tracks were deleted, clear the queue
      queue = [];
      queueSource = null;
      currentTrackFilename = null;
      currentTrackIndex = -1;
      if (nowPlaying) nowPlaying.textContent = 'No track';
      console.log('All saved tracks were deleted. Queue cleared.');
      return;
    }
  }

  // Validate the current track still exists
  const currentTrackExists = await validateTrackExists(state.filename);
  
  if (!currentTrackExists) {
    console.log(`Current track deleted: ${state.title || state.filename}`);
    
    // Find next valid track in queue
    if (validatedQueue.length > 0) {
      console.log('Loading first valid track from queue...');
      currentTrackFilename = validatedQueue[0].filename;
      currentTrackIndex = 0;
      if (nowPlaying) nowPlaying.textContent = validatedQueue[0].title || validatedQueue[0].filename;
      
      // Load the first valid track but don't auto-play it
      wavesurfer.load(`/uploads/music/${validatedQueue[0].filename}?t=${Date.now()}`);
      wavesurfer.once('ready', () => {
        if (durationSpan) durationSpan.textContent = formatTime(wavesurfer.getDuration());
        if (currentTimeSpan) currentTimeSpan.textContent = formatTime(0);
        wavesurfer.pause();
        updatePlayPauseLabel();
        syncActiveTrackCard();
        queueSavePlayerState();
      });
    } else {
      // No valid tracks, clear everything
      currentTrackFilename = null;
      currentTrackIndex = -1;
      if (nowPlaying) nowPlaying.textContent = 'No track';
    }
    return;
  }

  // Current track still exists, restore it
  currentTrackFilename = state.filename;
  if (Number.isInteger(state.trackIndex) && state.trackIndex >= 0 && state.trackIndex < queue.length) {
    currentTrackIndex = state.trackIndex;
  } else {
    // Try to find index in the validated queue
    currentTrackIndex = queue.findIndex(t => t.filename === state.filename);
  }

  if (nowPlaying) nowPlaying.textContent = state.title || state.filename;

  // Check if music is already playing/loaded - if so, don't reload to avoid interruption
  const isAlreadyPlaying = isPlayerReady && wavesurfer.isPlaying && wavesurfer.isPlaying();
  const currentUrl = wavesurfer.backend && wavesurfer.backend.media ? wavesurfer.backend.media.currentSrc : '';
  const targetUrl = `/uploads/music/${state.filename}`;
  const isSameTrack = currentUrl.includes(targetUrl);

  if (isAlreadyPlaying && isSameTrack) {
    // Track already playing, just sync UI state without reloading
    updatePlayPauseLabel();
    syncActiveTrackCard();
    queueSavePlayerState();
    return;
  }

  wavesurfer.load(`/uploads/music/${state.filename}?t=${Date.now()}`);
  wavesurfer.once('ready', () => {
    const duration = wavesurfer.getDuration() || 0;
    const targetTime = Number.isFinite(state.currentTime) ? state.currentTime : 0;
    if (duration > 0 && targetTime > 0) {
      const ratio = Math.min(1, Math.max(0, targetTime / duration));
      wavesurfer.seekTo(ratio);
    }

    if (durationSpan) durationSpan.textContent = formatTime(duration);
    if (currentTimeSpan) currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());

    if (state.wasPlaying) {
      wavesurfer.play();
    } else {
      wavesurfer.pause();
    }
    updatePlayPauseLabel();
    syncActiveTrackCard();
    queueSavePlayerState();
  });
}

function initFullReloadPersistence() {
  if (document.body.dataset.playerPersistenceBound === 'true') return;
  document.body.dataset.playerPersistenceBound = 'true';

  window.addEventListener('beforeunload', () => {
    savePlayerState();
  });

  window.addEventListener('pagehide', () => {
    savePlayerState();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      savePlayerState();
    }
  });

  document.addEventListener('submit', () => {
    savePlayerState();
  }, true);
}

function updatePlayPauseLabel() {
  const { playPauseBtn } = getPlayerEls();
  if (playPauseBtn && wavesurfer) {
    playPauseBtn.textContent = wavesurfer.isPlaying() ? 'Pause' : 'Play';
  }
}

function syncActiveTrackCard() {
  const musicCards = document.querySelectorAll('.music-card');
  musicCards.forEach(card => card.classList.remove('active'));
  if (!currentTrackFilename) return;

  musicCards.forEach(card => {
    const file = card.dataset.filename;
    if (file === currentTrackFilename) {
      card.classList.add('active');
    }
  });
}

function playTrack(index, shouldAutoplay = true) {
  if (!wavesurfer || index < 0 || index >= queue.length) return;

  const trackData = queue[index];
  if (!trackData || !trackData.filename) return;

  const { nowPlaying } = getPlayerEls();

  // Update visual state for DOM cards if on music page
  tracks.forEach(t => t.classList.remove('active'));
  const matchingCard = tracks.find(t => t.dataset.filename === trackData.filename);
  if (matchingCard) matchingCard.classList.add('active');

  currentTrackIndex = index;
  currentTrackFilename = trackData.filename;
  if (nowPlaying) nowPlaying.textContent = trackData.title || trackData.filename;

  wavesurfer.load(`/uploads/music/${trackData.filename}?t=${Date.now()}`);
  wavesurfer.once('ready', () => {
    if (shouldAutoplay) wavesurfer.play();
    updatePlayPauseLabel();
    queueSavePlayerState();
  });
  queueSavePlayerState();
}

function nextTrack() {
  if (queue.length && currentTrackIndex < queue.length - 1) {
    playTrack(currentTrackIndex + 1, true);
  }
}

function prevTrack() {
  if (queue.length && currentTrackIndex > 0) {
    playTrack(currentTrackIndex - 1, true);
  }
}

function seekByPointer(clientX) {
  const { waveformEl } = getPlayerEls();
  if (!wavesurfer || !waveformEl) return;
  const rect = waveformEl.getBoundingClientRect();
  if (rect.width <= 0) return;
  let ratio = (clientX - rect.left) / rect.width;
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;
  wavesurfer.seekTo(ratio);
}

function bindScrubbing() {
  const { waveformEl } = getPlayerEls();
  if (!waveformEl || waveformEl.dataset.scrubBound === 'true') return;
  waveformEl.dataset.scrubBound = 'true';

  waveformEl.addEventListener('pointerdown', (e) => {
    if (!wavesurfer) return;
    isScrubbing = true;
    seekByPointer(e.clientX);
    waveformEl.setPointerCapture(e.pointerId);
  });

  waveformEl.addEventListener('pointermove', (e) => {
    if (!isScrubbing || !wavesurfer) return;
    seekByPointer(e.clientX);
  });

  const endScrub = () => {
    isScrubbing = false;
  };

  waveformEl.addEventListener('pointerup', endScrub);
  waveformEl.addEventListener('pointercancel', endScrub);
  waveformEl.addEventListener('lostpointercapture', endScrub);
}

function bindPlayerControls() {
  const {
    playPauseBtn,
    prevBtn,
    nextBtn,
    volumeSlider,
    currentTimeSpan,
    durationSpan,
    nowPlaying,
    autoplayCheckbox,
    waveformEl
  } = getPlayerEls();

  if (!waveformEl || !playPauseBtn || !prevBtn || !nextBtn || !volumeSlider || !currentTimeSpan || !durationSpan || !nowPlaying || !autoplayCheckbox) {
    return;
  }

  if (!wavesurfer) {
    wavesurfer = WaveSurfer.create({
      container: '#waveform',
      waveColor: '#0ff',
      progressColor: '#a0a',
      height: 30,
      responsive: true,
      interact: true,
      dragToSeek: true
    });

    wavesurfer.on('ready', () => {
      isPlayerReady = true;
      durationSpan.textContent = formatTime(wavesurfer.getDuration());
      updatePlayPauseLabel();
    });

    wavesurfer.on('audioprocess', () => {
      currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seek', () => {
      currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      if (autoplayEnabled) nextTrack();
      updatePlayPauseLabel();
    });

    wavesurfer.on('play', updatePlayPauseLabel);
    wavesurfer.on('pause', updatePlayPauseLabel);
    
    // Handle track load errors (e.g., deleted files, 404s)
    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      const { nowPlaying } = getPlayerEls();
      
      // If current track failed to load, try next track or clear player
      if (currentTrackFilename) {
        console.log(`Failed to load track: ${currentTrackFilename}`);
        
        // Remove failed track from queue
        if (currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
          queue.splice(currentTrackIndex, 1);
          console.log(`Removed failed track from queue`);
        }
        
        // Try to play next track if available
        if (queue.length > 0 && currentTrackIndex < queue.length) {
          console.log('Attempting to play next track...');
          playTrack(currentTrackIndex, false);
        } else if (queue.length > 0 && currentTrackIndex > 0) {
          console.log('Attempting to play previous track...');
          playTrack(0, false);
        } else {
          // No valid tracks, clear player
          currentTrackFilename = null;
          currentTrackIndex = -1;
          if (nowPlaying) nowPlaying.textContent = 'Track unavailable';
          queueSavePlayerState();
        }
      }
    });
  }

  autoplayCheckbox.checked = autoplayEnabled;

  if (waveformEl.dataset.controlsBound !== 'true') {
    waveformEl.dataset.controlsBound = 'true';

    playPauseBtn.addEventListener('click', () => {
      if (!wavesurfer) return;
      if (!isPlayerReady && currentTrackIndex < 0 && queue.length > 0) {
        playTrack(0, true);
        return;
      }
      wavesurfer.playPause();
      updatePlayPauseLabel();
      queueSavePlayerState();
    });

    prevBtn.addEventListener('click', prevTrack);
    nextBtn.addEventListener('click', nextTrack);

    volumeSlider.addEventListener('input', (e) => {
      if (wavesurfer) wavesurfer.setVolume(e.target.value);
      queueSavePlayerState();
    });

    autoplayCheckbox.addEventListener('change', () => {
      autoplayEnabled = autoplayCheckbox.checked;
      localStorage.setItem('musicAutoplay', autoplayEnabled ? 'true' : 'false');
      queueSavePlayerState();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !wavesurfer || currentTrackIndex < 0) return;
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      wavesurfer.playPause();
      updatePlayPauseLabel();
      queueSavePlayerState();
    });
  }

  bindScrubbing();
  restorePlayerStateIfNeeded();
}

function buildQueueFromDOMCards() {
  // Extract serializable metadata from .music-card elements
  const cards = document.querySelectorAll('.music-card');
  const queueData = [];
  
  cards.forEach((card) => {
    const filename = card.dataset.filename;
    const titleEl = card.querySelector('h3');
    const title = titleEl ? titleEl.innerText.trim() : filename;
    const id = card.dataset.musicId || null; // if music_id is available
    
    if (filename) {
      queueData.push({ filename, title, id });
    }
  });
  
  return queueData;
}

function detectQueueSource() {
  // Detect the current queue source from URL params
  const params = new URLSearchParams(window.location.search);
  const playlistId = params.get('playlist');
  const search = params.get('search');
  
  if (playlistId) {
    return { type: 'playlist', playlistId: parseInt(playlistId, 10), search };
  } else {
    return { type: 'all', playlistId: null, search };
  }
}

function initMusicPageFeatures() {
  const cards = document.querySelectorAll('.music-card');
  tracks = Array.from(cards);

  // Build queue from current page cards
  const pageQueue = buildQueueFromDOMCards();
  const pageSource = detectQueueSource();
  
  // Only update queue if we're on /music and have cards
  // OR if there's no queue yet (first load)
  if (pageQueue.length > 0 && (window.location.pathname === '/music' || queue.length === 0)) {
    queue = pageQueue;
    queueSource = pageSource;
  }

  tracks.forEach((item, index) => {
    item.addEventListener('click', () => playTrack(index, true));
  });

  const playlistHeaders = document.querySelectorAll('.playlist-item .playlist-header');
  playlistHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const item = header.closest('.playlist-item');
      if (item) item.classList.toggle('expanded');
    });
  });

  // Sync current track index when returning to /music page
  if (currentTrackFilename && queue.length > 0) {
    const currentIndex = queue.findIndex(t => t.filename === currentTrackFilename);
    if (currentIndex >= 0) {
      currentTrackIndex = currentIndex;
    }
  }
  syncActiveTrackCard();
}

function initVideoControls() {
  const videoControls = document.querySelectorAll('.video-controls');
  videoControls.forEach(control => {
    const videoId = control.dataset.videoId;
    const video = document.getElementById(`video-${videoId}`);
    if (!video || control.dataset.bound === 'true') return;
    control.dataset.bound = 'true';

    const playPauseBtn = control.querySelector('.play-pause');
    const volumeSlider = control.querySelector('.volume');
    const currentTimeSpan = control.querySelector('.current-time');
    const durationSpan = control.querySelector('.duration');
    const fullscreenBtn = control.querySelector('.fullscreen');

    video.addEventListener('loadedmetadata', () => {
      durationSpan.textContent = formatTime(video.duration);
    });

    video.addEventListener('timeupdate', () => {
      currentTimeSpan.textContent = formatTime(video.currentTime);
    });

    playPauseBtn.addEventListener('click', () => {
      if (video.paused) {
        video.play();
        playPauseBtn.textContent = 'Pause';
      } else {
        video.pause();
        playPauseBtn.textContent = 'Play';
      }
    });

    volumeSlider.addEventListener('input', (e) => {
      video.volume = e.target.value;
    });

    fullscreenBtn.addEventListener('click', () => {
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
      else if (video.msRequestFullscreen) video.msRequestFullscreen();
    });
  });
}

function initGalleryLightbox() {
  const galleryItems = document.querySelectorAll('.gallery-item a');
  galleryItems.forEach(link => {
    if (link.dataset.bound === 'true') return;
    link.dataset.bound = 'true';
    link.addEventListener('click', e => {
      e.preventDefault();
      const src = link.getAttribute('href');
      const overlay = document.createElement('div');
      overlay.classList.add('lightbox');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Gallery viewer');
      const img = document.createElement('img');
      img.src = src;

      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.textContent = 'Back to gallery';
      backBtn.className = 'back-link';
      backBtn.style.position = 'absolute';
      backBtn.style.top = '1rem';
      backBtn.style.left = '1rem';
      backBtn.style.background = 'transparent';
      backBtn.style.border = '1px solid #0ff';
      backBtn.style.padding = '0.3rem 0.6rem';

      backBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
      });

      overlay.appendChild(backBtn);
      overlay.appendChild(img);
      overlay.addEventListener('click', () => document.body.removeChild(overlay));
      document.body.appendChild(overlay);
    });
  });
}

function initAdminMembershipToggles() {
  const toggleButtons = document.querySelectorAll('.toggle-membership');
  toggleButtons.forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const li = btn.closest('li');
      if (!li) return;
      const panel = li.querySelector('.membership-panel');
      if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
  });
}

function initPageFeatures() {
  bindPlayerControls();
  initFullReloadPersistence();
  initMusicPageFeatures();
  initVideoControls();
  initGalleryLightbox();
  initAdminMembershipToggles();
  syncActiveTrackCard();
  queueSavePlayerState();
}

async function softNavigate(url, replace = false) {
  const response = await fetch(url, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest'
    },
    credentials: 'same-origin' // Ensure cookies are sent
  });
  if (!response.ok) {
    window.location.href = url;
    return;
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const incomingMain = doc.querySelector('main');
  const currentMain = document.querySelector('main');
  if (!incomingMain || !currentMain) {
    window.location.href = url;
    return;
  }

  currentMain.innerHTML = incomingMain.innerHTML;
  document.title = doc.title || document.title;
  if (replace) {
    history.replaceState({}, '', url);
  } else {
    history.pushState({}, '', url);
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  initPageFeatures();
}

async function softSubmitForm(form) {
  // Prevent default browser submit, handle via fetch to keep player alive
  const method = form.method.toUpperCase() || 'POST';
  const action = form.action || window.location.href;

  // Non-file forms should use urlencoded bodies so Express urlencoded middleware
  // parses req.body correctly on routes that don't use multer.
  const hasFileInput = !!form.querySelector('input[type="file"]');
  const isMultipart = (form.enctype || '').toLowerCase() === 'multipart/form-data';
  const shouldUseFormData = hasFileInput || isMultipart;
  const formData = new FormData(form);
  const body = shouldUseFormData ? formData : new URLSearchParams(formData);
  const headers = {
    'X-Requested-With': 'XMLHttpRequest'
  };

  if (!shouldUseFormData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  try {
    const response = await fetch(action, {
      method: method,
      body,
      headers,
      credentials: 'same-origin', // Ensure session cookies are sent
      redirect: 'follow' // Follow redirects automatically
    });

    if (!response.ok) {
      // If fetch fails, fall back to normal submit
      form.submit();
      return;
    }

    // Get the final URL after redirects
    const finalUrl = response.url;

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const incomingMain = doc.querySelector('main');
    const currentMain = document.querySelector('main');

    if (!incomingMain || !currentMain) {
      // If we can't parse properly, fall back to normal navigation
      window.location.href = finalUrl;
      return;
    }

    // Update page content without destroying player
    currentMain.innerHTML = incomingMain.innerHTML;
    document.title = doc.title || document.title;
    
    // Update URL to match final destination (after redirects)
    if (finalUrl !== window.location.href) {
      history.pushState({}, '', finalUrl);
    }
    
    window.scrollTo({ top: 0, behavior: 'auto' });
    initPageFeatures();
    queueSavePlayerState(); // Save state after successful form submission
  } catch (err) {
    console.error('Soft form submit error:', err);
    // On error, fall back to normal form submission
    form.submit();
  }
}

function shouldHandleSoftNav(anchor) {
  if (!anchor) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  if (anchor.dataset.noSoftNav === 'true') return false;
  if (!anchor.href) return false;

  const url = new URL(anchor.href, window.location.origin);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname.startsWith('/uploads/')) return false;
  if (url.hash && url.pathname === window.location.pathname) return false;
  return true;
}

function initSoftNavigation() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const anchor = e.target.closest('a');
    if (!shouldHandleSoftNav(anchor)) return;

    e.preventDefault();
    softNavigate(anchor.href);
  });

  window.addEventListener('popstate', () => {
    softNavigate(window.location.href, true);
  });

  // Intercept form submissions to prevent full page reloads
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    
    // Skip forms with data-no-soft-submit attribute
    if (form.dataset.noSoftSubmit === 'true') return;
    
    // Skip external forms
    if (form.action && !form.action.startsWith(window.location.origin)) return;

    // Any form containing password input should use native submit for safer auth/session flow.
    if (form.querySelector('input[type="password"]')) return;

    // Auth boundaries should use normal full submissions for reliable session/cookie flow.
    const actionUrl = new URL(form.action || window.location.href, window.location.origin);
    if (actionUrl.pathname === '/login' || actionUrl.pathname === '/logout') return;
    
    e.preventDefault();
    softSubmitForm(form);
  }, true);
}

document.addEventListener('DOMContentLoaded', () => {
  initPageFeatures();
  initSoftNavigation();
});
