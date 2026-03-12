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
let isRestoringPlayerState = false;
let playerLabelState = 'idle';
let trackChangeSequence = 0;
let activeTrackChange = null;
let lastHandledFinish = null;
let saveTimer = null;
const PLAYER_STATE_KEY = 'nightvaultPlayerState.v2';
const LEGACY_PLAYER_STATE_KEY = 'paracausalPlayerState.v2';
const TRACK_URL_BASE = '/uploads/music/';
const REPEAT_MODE_SEQUENCE = ['off', 'one', 'all'];
let shuffleEnabled = false;
let repeatMode = 'off';
let playbackOrder = [];
let playbackOrderPosition = -1;

function migrateLegacyPlayerState() {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(PLAYER_STATE_KEY) !== null) return;

  const legacyState = localStorage.getItem(LEGACY_PLAYER_STATE_KEY);
  if (legacyState === null) return;

  localStorage.setItem(PLAYER_STATE_KEY, legacyState);
}

migrateLegacyPlayerState();

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
    shuffleToggleBtn: document.getElementById('shuffle-toggle'),
    repeatToggleBtn: document.getElementById('repeat-toggle'),
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

function normalizeTrack(track) {
  if (!track || !track.filename) return null;

  return {
    filename: track.filename,
    title: (track.title || track.filename || '').trim(),
    artist: (track.artist || '').trim(),
    album: (track.album || '').trim(),
    year: track.year || '',
    description: (track.description || '').trim(),
    coverUrl: (track.coverUrl || '').trim(),
    coverAlt: (track.coverAlt || '').trim(),
    id: track.id || null
  };
}

function getTrackLabel(track) {
  const normalizedTrack = normalizeTrack(track);
  if (!normalizedTrack) return 'No track';
  return normalizedTrack.artist
    ? `${normalizedTrack.title} - ${normalizedTrack.artist}`
    : normalizedTrack.title;
}

function getCurrentTrackData() {
  if (!currentTrackFilename) return null;
  return queue.find((track) => track && track.filename === currentTrackFilename) || null;
}

function getTrackDataFromCard(card) {
  if (!card) return null;

  return normalizeTrack({
    filename: card.dataset.filename,
    title: card.dataset.title,
    artist: card.dataset.artist,
    album: card.dataset.album,
    year: card.dataset.year,
    description: card.dataset.description,
    coverUrl: card.dataset.coverUrl,
    coverAlt: card.dataset.coverAlt,
    id: card.dataset.musicId || null,
  });
}

function getMusicDetailPanelEls() {
  return {
    panel: document.getElementById('music-detail-panel'),
    empty: document.getElementById('music-detail-empty'),
    content: document.getElementById('music-detail-content'),
    coverWrap: document.getElementById('music-detail-cover-wrap'),
    cover: document.getElementById('music-detail-cover'),
    title: document.getElementById('music-detail-title'),
    artist: document.getElementById('music-detail-artist'),
    meta: document.getElementById('music-detail-meta'),
    description: document.getElementById('music-detail-description'),
  };
}

function renderMusicDetailPanel(track) {
  const els = getMusicDetailPanelEls();
  if (!els.panel) return;

  const normalizedTrack = normalizeTrack(track);
  if (!normalizedTrack) {
    if (els.empty) els.empty.hidden = false;
    if (els.content) els.content.hidden = true;
    return;
  }

  const metaRows = [];
  if (normalizedTrack.album) metaRows.push({ label: 'Album', value: normalizedTrack.album });
  if (normalizedTrack.year) metaRows.push({ label: 'Year', value: normalizedTrack.year });

  if (els.title) els.title.textContent = normalizedTrack.title || 'Untitled track';
  if (els.artist) {
    els.artist.textContent = normalizedTrack.artist || 'Artist unknown';
  }
  if (els.meta) {
    els.meta.innerHTML = '';
    const rows = metaRows.length ? metaRows : [{ label: 'Info', value: 'No extra metadata available' }];
    rows.forEach((row) => {
      const wrapper = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = row.label;
      dd.textContent = row.value;
      wrapper.appendChild(dt);
      wrapper.appendChild(dd);
      els.meta.appendChild(wrapper);
    });
  }
  if (els.description) {
    els.description.textContent = normalizedTrack.description || 'No description available for this track.';
  }
  if (els.coverWrap && els.cover) {
    if (normalizedTrack.coverUrl) {
      els.cover.src = normalizedTrack.coverUrl;
      els.cover.alt = normalizedTrack.coverAlt || `${normalizedTrack.title} cover`;
      els.coverWrap.hidden = false;
    } else {
      els.cover.removeAttribute('src');
      els.coverWrap.hidden = true;
    }
  }

  if (els.empty) els.empty.hidden = true;
  if (els.content) els.content.hidden = false;
}

function syncMusicDetailPanel(track = null) {
  const panelEls = getMusicDetailPanelEls();
  if (!panelEls.panel) return;

  const normalizedTrack = normalizeTrack(track);
  if (normalizedTrack) {
    renderMusicDetailPanel(normalizedTrack);
    return;
  }

  if (currentTrackFilename) {
    const matchingCard = Array.from(document.querySelectorAll('.music-card')).find(
      (card) => card.dataset.filename === currentTrackFilename
    );
    if (matchingCard) {
      renderMusicDetailPanel(getTrackDataFromCard(matchingCard));
      return;
    }

    const currentTrack = getCurrentTrackData();
    if (currentTrack) {
      renderMusicDetailPanel(currentTrack);
      return;
    }
  }

  renderMusicDetailPanel(null);
}

function refreshPlayerUI(fallbackText = 'No track') {
  const { nowPlaying } = getPlayerEls();
  if (!nowPlaying) return;

  const currentTrack = getCurrentTrackData();
  if (playerLabelState === 'unavailable') {
    nowPlaying.textContent = 'Track unavailable';
    return;
  }

  if (currentTrack) {
    nowPlaying.textContent = getTrackLabel(currentTrack);
    return;
  }

  nowPlaying.textContent = currentTrackFilename || fallbackText;
}

function setNowPlayingTrack(track, fallbackText = 'No track') {
  const normalizedTrack = normalizeTrack(track);
  playerLabelState = normalizedTrack ? 'active' : (fallbackText === 'Track unavailable' ? 'unavailable' : 'idle');
  refreshPlayerUI(fallbackText);
}

function getActiveMediaSnapshot() {
  const media = wavesurfer && wavesurfer.backend ? wavesurfer.backend.media : null;
  return {
    media,
    currentSrc: media && media.currentSrc ? media.currentSrc : '',
    hasError: !!(media && media.error),
    readyState: media ? media.readyState : 0,
  };
}

function getFilenameFromMediaSrc(src) {
  if (!src) return '';

  const marker = TRACK_URL_BASE;
  const markerIndex = src.indexOf(marker);
  if (markerIndex === -1) return '';

  const pathRemainder = src.slice(markerIndex + marker.length);
  return pathRemainder.split('?')[0].trim();
}

function getActiveMediaFilename() {
  return getFilenameFromMediaSrc(getActiveMediaSnapshot().currentSrc);
}

function normalizeRepeatMode(mode) {
  return REPEAT_MODE_SEQUENCE.includes(mode) ? mode : 'off';
}

function getRepeatModeLabel() {
  if (repeatMode === 'one') return 'Repeat One';
  if (repeatMode === 'all') return 'Repeat All';
  return 'Repeat Off';
}

function updatePlaybackModeControls() {
  const { shuffleToggleBtn, repeatToggleBtn } = getPlayerEls();

  if (shuffleToggleBtn) {
    shuffleToggleBtn.classList.toggle('is-active', shuffleEnabled);
    shuffleToggleBtn.setAttribute('aria-pressed', shuffleEnabled ? 'true' : 'false');
    shuffleToggleBtn.textContent = 'Shuffle';
    shuffleToggleBtn.title = shuffleEnabled ? 'Shuffle enabled' : 'Shuffle disabled';
  }

  if (repeatToggleBtn) {
    repeatToggleBtn.classList.toggle('is-active', repeatMode !== 'off');
    repeatToggleBtn.setAttribute('aria-pressed', repeatMode === 'off' ? 'false' : 'true');
    repeatToggleBtn.dataset.repeatMode = repeatMode;
    repeatToggleBtn.textContent = getRepeatModeLabel();
    repeatToggleBtn.title = `Current repeat mode: ${getRepeatModeLabel()}`;
  }
}

function getQueueFilenames() {
  return queue.map((track) => (track && track.filename ? track.filename : '')).filter(Boolean);
}

function shuffleList(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function buildPlaybackOrder(currentFilename = currentTrackFilename) {
  const filenames = Array.from(new Set(getQueueFilenames()));
  if (!filenames.length) return [];

  if (!shuffleEnabled) {
    return filenames;
  }

  if (currentFilename && filenames.includes(currentFilename)) {
    const remaining = filenames.filter((filename) => filename !== currentFilename);
    return [currentFilename, ...shuffleList(remaining)];
  }

  return shuffleList(filenames.slice());
}

function syncPlaybackOrderState(currentFilename = currentTrackFilename, { rebuild = false } = {}) {
  const validFilenames = Array.from(new Set(getQueueFilenames()));
  if (!validFilenames.length) {
    playbackOrder = [];
    playbackOrderPosition = -1;
    return;
  }

  if (rebuild || !Array.isArray(playbackOrder) || playbackOrder.length === 0) {
    playbackOrder = buildPlaybackOrder(currentFilename);
  } else if (!shuffleEnabled) {
    playbackOrder = validFilenames.slice();
  } else {
    const validSet = new Set(validFilenames);
    const orderedFilenames = [];

    playbackOrder.forEach((filename) => {
      if (validSet.has(filename) && !orderedFilenames.includes(filename)) {
        orderedFilenames.push(filename);
      }
    });

    const missingFilenames = validFilenames.filter((filename) => !orderedFilenames.includes(filename));
    playbackOrder = orderedFilenames.concat(shuffleList(missingFilenames));
  }

  if (currentFilename && validFilenames.includes(currentFilename)) {
    if (!playbackOrder.includes(currentFilename)) {
      playbackOrder = buildPlaybackOrder(currentFilename);
    }
    playbackOrderPosition = playbackOrder.indexOf(currentFilename);
    return;
  }

  playbackOrderPosition = -1;
}

function getTrackIndexByFilename(filename) {
  if (!filename) return -1;
  return queue.findIndex((track) => track && track.filename === filename);
}

function getInitialTrackIndex() {
  if (!queue.length) return -1;
  syncPlaybackOrderState(currentTrackFilename);

  const startFilename = shuffleEnabled && playbackOrder.length
    ? playbackOrder[0]
    : (queue[0] && queue[0].filename ? queue[0].filename : '');

  return getTrackIndexByFilename(startFilename);
}

function getPlaybackStepTarget(direction, { wrap = false } = {}) {
  if (!queue.length) return null;

  syncPlaybackOrderState(currentTrackFilename);
  if (!playbackOrder.length) return null;

  if (currentTrackFilename) {
    const currentPosition = playbackOrder.indexOf(currentTrackFilename);
    if (currentPosition >= 0) {
      playbackOrderPosition = currentPosition;
    }
  }

  let basePosition = playbackOrderPosition;
  if (basePosition < 0) {
    basePosition = direction > 0 ? -1 : 0;
  }

  let targetPosition = basePosition + direction;
  if (targetPosition >= playbackOrder.length) {
    if (!wrap) return null;
    targetPosition = 0;
  }

  if (targetPosition < 0) {
    if (!wrap) return null;
    targetPosition = playbackOrder.length - 1;
  }

  const targetFilename = playbackOrder[targetPosition];
  const targetIndex = getTrackIndexByFilename(targetFilename);
  if (targetIndex < 0) return null;

  return {
    filename: targetFilename,
    index: targetIndex,
    position: targetPosition,
  };
}

function cycleRepeatMode() {
  const currentModeIndex = REPEAT_MODE_SEQUENCE.indexOf(repeatMode);
  const nextModeIndex = (currentModeIndex + 1) % REPEAT_MODE_SEQUENCE.length;
  repeatMode = REPEAT_MODE_SEQUENCE[nextModeIndex];
  updatePlaybackModeControls();
  queueSavePlayerState();
}

function toggleShuffleMode() {
  shuffleEnabled = !shuffleEnabled;
  syncPlaybackOrderState(currentTrackFilename, { rebuild: true });
  updatePlaybackModeControls();
  queueSavePlayerState();
}

function restartCurrentTrackFromBeginning() {
  if (!wavesurfer || currentTrackIndex < 0) return;

  const startPlayback = () => {
    const playPromise = wavesurfer.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('Repeat-one playback restart failed:', err && err.message ? err.message : err);
      });
    }
  };

  wavesurfer.seekTo(0);
  const media = prepareMediaElementForPlayback();
  if (media && media.readyState < 3) {
    media.addEventListener('canplay', startPlayback, { once: true });
  } else {
    startPlayback();
  }

  updatePlayPauseLabel();
  queueSavePlayerState();
}

function handleTrackFinish() {
  if (!shouldHandleFinishEvent()) return;
  if (!autoplayEnabled) return;

  if (repeatMode === 'one') {
    restartCurrentTrackFromBeginning();
    return;
  }

  const target = getPlaybackStepTarget(1, { wrap: repeatMode === 'all' });
  if (target) {
    transitionToTrack(target.index, true, 'autoplay-finish', { playbackPosition: target.position });
  }
}

function shouldHandleFinishEvent() {
  const finishedFilename = getActiveMediaFilename() || currentTrackFilename;
  if (!finishedFilename) return false;

  if (activeTrackChange && activeTrackChange.source === 'autoplay-finish') {
    return false;
  }

  if (
    activeTrackChange &&
    activeTrackChange.source === 'autoplay-finish' &&
    activeTrackChange.fromFilename === finishedFilename
  ) {
    return false;
  }

  const now = Date.now();
  if (
    lastHandledFinish &&
    lastHandledFinish.filename === finishedFilename &&
    now - lastHandledFinish.at < 2000
  ) {
    return false;
  }

  lastHandledFinish = { filename: finishedFilename, at: now };
  return true;
}

function getTrackUrlFragment(filename) {
  return filename ? `${TRACK_URL_BASE}${filename}` : '';
}

function getTrackUrl(filename) {
  return getTrackUrlFragment(filename);
}

function getDesiredPlayerVolume() {
  const { volumeSlider } = getPlayerEls();

  if (wavesurfer && typeof wavesurfer.getVolume === 'function') {
    const volume = wavesurfer.getVolume();
    if (Number.isFinite(volume)) {
      return Math.min(1, Math.max(0, volume));
    }
  }

  const sliderValue = parseFloat(volumeSlider ? volumeSlider.value : '0.5');
  if (Number.isFinite(sliderValue)) {
    return Math.min(1, Math.max(0, sliderValue));
  }

  return 0.5;
}

function setMediaElementVolume(media, volume) {
  if (!media) return;
  const safeVolume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));

  try {
    media.volume = safeVolume;
  } catch (err) {
    // Ignore direct media volume failures and continue with transition.
  }
}

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 16);
      return;
    }

    window.requestAnimationFrame(() => resolve());
  });
}

function getTransitionAudioOptions(source) {
  const isManualSkip = source === 'manual-next' || source === 'manual-prev';

  return {
    flushSource: isManualSkip,
    resetPlaybackHead: true,
    awaitFlushFrame: isManualSkip,
  };
}

function prepareMediaElementForPlayback() {
  const media = wavesurfer && wavesurfer.backend ? wavesurfer.backend.media : null;
  if (!media) return null;

  media.preload = 'auto';
  return media;
}

function mediaMatchesExpectedUrl(media, expectedUrl) {
  if (!expectedUrl) return true;
  if (!media || !media.currentSrc) return false;
  return media.currentSrc.includes(expectedUrl);
}

async function stopActiveMediaForTransition(options = {}) {
  const media = prepareMediaElementForPlayback();
  if (!media) return;

  const {
    flushSource = false,
    resetPlaybackHead = true,
    awaitFlushFrame = false,
  } = options;

  setMediaElementVolume(media, 0);

  try {
    media.muted = true;
  } catch (err) {
    // Ignore property assignment failures on older browsers.
  }

  try {
    media.pause();
  } catch (err) {
    console.warn('Media pause before track transition failed:', err && err.message ? err.message : err);
  }

  try {
    media.autoplay = false;
  } catch (err) {
    // Ignore property assignment failures on older browsers.
  }

  if (resetPlaybackHead) {
    try {
      media.currentTime = 0;
    } catch (err) {
      // Ignore seek failures while tearing down the old source.
    }
  }

  if (flushSource) {
    try {
      media.removeAttribute('src');
      media.load();
    } catch (err) {
      // Ignore flush failures and continue to the next load attempt.
    }
  }

  if (awaitFlushFrame) {
    await waitForAnimationFrame();
  }
}

function restoreMediaAfterTransition(changeId, options = {}) {
  const media = prepareMediaElementForPlayback();
  if (!media) return Promise.resolve();
  if (changeId !== null) {
    if (!activeTrackChange || activeTrackChange.id !== changeId) {
      return Promise.resolve();
    }

    if (activeTrackChange.mediaRestoreApplied) {
      return Promise.resolve();
    }

    activeTrackChange.mediaRestoreApplied = true;
  }

  const desiredVolume = getDesiredPlayerVolume();
  const shouldAbort = () => !activeTrackChange || activeTrackChange.id !== changeId;

  try {
    media.muted = false;
  } catch (err) {
    // Ignore property assignment failures on older browsers.
  }

  if (typeof shouldAbort === 'function' && shouldAbort()) {
    return Promise.resolve();
  }

  setMediaElementVolume(media, desiredVolume);
  return Promise.resolve();
}

function attemptImmediatePlayback(changeId, options = {}) {
  if (changeId !== null && (!activeTrackChange || activeTrackChange.id !== changeId)) return;

  const expectedTrack = changeId !== null && activeTrackChange ? activeTrackChange.track : null;
  const expectedUrl = expectedTrack ? getTrackUrl(expectedTrack.filename) : '';

  const media = prepareMediaElementForPlayback();
  if (!media) {
    const playPromise = wavesurfer.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('Immediate WaveSurfer playback start failed:', err && err.message ? err.message : err);
      });
    }
    return;
  }

  const startPlayback = () => {
    if (changeId !== null && (!activeTrackChange || activeTrackChange.id !== changeId)) return;

    if (!mediaMatchesExpectedUrl(media, expectedUrl)) {
      return;
    }

    restoreMediaAfterTransition(changeId, options);

    const playPromise = media.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('Deferred playback start failed:', err && err.message ? err.message : err);
      });
    }
  };

  if (!mediaMatchesExpectedUrl(media, expectedUrl)) {
    media.addEventListener('loadedmetadata', startPlayback, { once: true });
    media.addEventListener('canplay', startPlayback, { once: true });
    return;
  }

  if (media.readyState >= 3) {
    startPlayback();
    return;
  }

  media.addEventListener('canplay', startPlayback, { once: true });
}

function shouldIgnoreWaveSurferError(failedFilename = '') {
  const expectedUrl = getTrackUrlFragment(failedFilename || currentTrackFilename);
  if (!expectedUrl) return false;

  const { currentSrc, hasError, readyState } = getActiveMediaSnapshot();
  const mediaFilename = getActiveMediaFilename();

  if (currentSrc.includes(expectedUrl) && !hasError && readyState > 0) {
    return true;
  }

  if (!activeTrackChange) return false;

  const previousUrl = getTrackUrlFragment(activeTrackChange.fromFilename);
  const targetUrl = getTrackUrlFragment(activeTrackChange.track && activeTrackChange.track.filename);
  const previousFilename = activeTrackChange.fromFilename || '';
  const targetFilename = activeTrackChange.track && activeTrackChange.track.filename
    ? activeTrackChange.track.filename
    : '';

  if (mediaFilename && targetFilename && mediaFilename !== targetFilename) {
    return true;
  }

  if (mediaFilename && previousFilename && mediaFilename === previousFilename) {
    return true;
  }

  // Ignore teardown/abort noise from the track we just left while a new one is loading.
  if (previousUrl && currentSrc.includes(previousUrl) && (!targetUrl || !currentSrc.includes(targetUrl))) {
    return true;
  }

  // Ignore transient swap states until the new media element reports a real error.
  if (!currentSrc && !hasError) {
    return true;
  }

  return false;
}

function clearActiveTrackChange(changeId = null) {
  if (!activeTrackChange) return;
  if (changeId !== null && activeTrackChange.id !== changeId) return;
  activeTrackChange = null;
}

function removeTrackFromQueue(filename) {
  if (!filename) return -1;

  const failedIndex = queue.findIndex((track) => track && track.filename === filename);
  if (failedIndex === -1) return -1;

  const failedPlaybackPosition = playbackOrder.indexOf(filename);
  const fallbackPlaybackOrder = playbackOrder.filter((trackFilename) => trackFilename !== filename);
  const fallbackFilename = failedPlaybackPosition >= 0 && fallbackPlaybackOrder.length > 0
    ? fallbackPlaybackOrder[Math.min(failedPlaybackPosition, fallbackPlaybackOrder.length - 1)]
    : null;

  queue.splice(failedIndex, 1);

  if (queue.length === 0) {
    currentTrackIndex = -1;
    currentTrackFilename = null;
    playbackOrder = [];
    playbackOrderPosition = -1;
    return -1;
  }

  if (failedIndex < currentTrackIndex) {
    currentTrackIndex -= 1;
  } else if (failedIndex === currentTrackIndex) {
    currentTrackFilename = fallbackFilename;
    currentTrackIndex = fallbackFilename ? getTrackIndexByFilename(fallbackFilename) : -1;

    if (currentTrackIndex < 0) {
      currentTrackIndex = Math.min(failedIndex, queue.length - 1);
      currentTrackFilename = queue[currentTrackIndex] ? queue[currentTrackIndex].filename : null;
    }
  }

  syncPlaybackOrderState(currentTrackFilename);

  return failedIndex;
}

function queueSavePlayerState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(savePlayerState, 120);
}

function savePlayerState() {
  if (!wavesurfer) return;
  if (isRestoringPlayerState) return;

  const { volumeSlider } = getPlayerEls();
  const volume = wavesurfer.getVolume ? wavesurfer.getVolume() : parseFloat(volumeSlider ? volumeSlider.value : '0.5');
  const currentTime = isPlayerReady ? wavesurfer.getCurrentTime() : 0;
  const currentTrack = getCurrentTrackData();

  const state = {
    filename: currentTrackFilename,
    title: currentTrack ? getTrackLabel(currentTrack) : getNowPlayingText(),
    track: currentTrack ? { ...currentTrack } : null,
    currentTime: Number.isFinite(currentTime) ? currentTime : 0,
    wasPlaying: !!(wavesurfer.isPlaying && wavesurfer.isPlaying()),
    volume: Number.isFinite(volume) ? volume : 0.5,
    autoplayEnabled: !!autoplayEnabled,
    shuffleEnabled: !!shuffleEnabled,
    repeatMode: normalizeRepeatMode(repeatMode),
    trackIndex: currentTrackIndex,
    queue: queue.slice(), // save the full queue
    playbackOrder: playbackOrder.slice(),
    playbackOrderPosition: playbackOrderPosition,
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
  isRestoringPlayerState = true;

  try {
    const state = loadPlayerState();
    if (!state || !state.filename) return;

    const {
      volumeSlider,
      autoplayCheckbox,
      currentTimeSpan,
      durationSpan
    } = getPlayerEls();

    shuffleEnabled = !!state.shuffleEnabled;
    repeatMode = normalizeRepeatMode(state.repeatMode);
    playbackOrder = Array.isArray(state.playbackOrder)
      ? state.playbackOrder.filter((filename) => typeof filename === 'string' && filename.trim())
      : [];
    playbackOrderPosition = Number.isInteger(state.playbackOrderPosition) ? state.playbackOrderPosition : -1;
    updatePlaybackModeControls();

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
      validatedQueue = (await filterValidTracks(state.queue)).map(normalizeTrack).filter(Boolean);
      console.log(`Queue validation complete: ${validatedQueue.length} valid tracks`);

      if (validatedQueue.length > 0) {
        queue = validatedQueue;
        queueSource = state.queueSource || null;
        syncPlaybackOrderState(state.filename, { rebuild: playbackOrder.length === 0 });
      } else {
        queue = [];
        queueSource = null;
        currentTrackFilename = null;
        currentTrackIndex = -1;
        playbackOrder = [];
        playbackOrderPosition = -1;
        playerLabelState = 'idle';
        setNowPlayingTrack(null);
        console.log('All saved tracks were deleted. Queue cleared.');
        return;
      }
    }

    const currentTrackExists = await validateTrackExists(state.filename);
    if (!currentTrackExists) {
      console.log(`Current track deleted: ${state.title || state.filename}`);

      if (validatedQueue.length > 0) {
        console.log('Loading first valid track from queue...');
        currentTrackFilename = validatedQueue[0].filename;
        currentTrackIndex = 0;
        syncPlaybackOrderState(currentTrackFilename, { rebuild: true });
        playerLabelState = 'active';
        setNowPlayingTrack(validatedQueue[0]);

        wavesurfer.load(getTrackUrl(validatedQueue[0].filename));
        wavesurfer.once('ready', () => {
          if (durationSpan) durationSpan.textContent = formatTime(wavesurfer.getDuration());
          if (currentTimeSpan) currentTimeSpan.textContent = formatTime(0);
          wavesurfer.pause();
          refreshPlayerUI();
          updatePlayPauseLabel();
          syncActiveTrackCard();
          queueSavePlayerState();
        });
      } else {
        currentTrackFilename = null;
        currentTrackIndex = -1;
        playbackOrder = [];
        playbackOrderPosition = -1;
        playerLabelState = 'idle';
        setNowPlayingTrack(null);
      }
      return;
    }

    currentTrackFilename = state.filename;
    if (Number.isInteger(state.trackIndex) && state.trackIndex >= 0 && state.trackIndex < queue.length) {
      currentTrackIndex = state.trackIndex;
    } else {
      currentTrackIndex = queue.findIndex((track) => track.filename === state.filename);
    }
    syncPlaybackOrderState(currentTrackFilename, { rebuild: playbackOrder.length === 0 });

    const restoredTrack = getCurrentTrackData() || normalizeTrack(state.track);
    playerLabelState = restoredTrack ? 'active' : 'idle';
    setNowPlayingTrack(restoredTrack, state.title || state.filename);

    const isAlreadyPlaying = isPlayerReady && wavesurfer.isPlaying && wavesurfer.isPlaying();
    const currentUrl = wavesurfer.backend && wavesurfer.backend.media ? wavesurfer.backend.media.currentSrc : '';
    const targetUrl = getTrackUrl(state.filename);
    const isSameTrack = currentUrl.includes(targetUrl);

    if (isAlreadyPlaying && isSameTrack) {
      refreshPlayerUI();
      updatePlayPauseLabel();
      syncActiveTrackCard();
      queueSavePlayerState();
      return;
    }

    wavesurfer.load(getTrackUrl(state.filename));
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
      refreshPlayerUI();
      updatePlayPauseLabel();
      syncActiveTrackCard();
      queueSavePlayerState();
    });
  } finally {
    isRestoringPlayerState = false;
  }
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
  if (!currentTrackFilename) {
    syncMusicDetailPanel(null);
    return;
  }

  musicCards.forEach(card => {
    const file = card.dataset.filename;
    if (file === currentTrackFilename) {
      card.classList.add('active');
    }
  });

  syncMusicDetailPanel();
}

function transitionToTrack(index, shouldAutoplay = true, source = 'direct', options = {}) {
  if (!wavesurfer || index < 0 || index >= queue.length) return;

  const { playbackPosition = null, rebuildOrder = false } = options;
  const transitionAudio = getTransitionAudioOptions(source);

  const trackData = normalizeTrack(queue[index]);
  if (!trackData || !trackData.filename) return;
  const changeId = ++trackChangeSequence;
  const fromFilename = currentTrackFilename;

  // Update visual state for DOM cards if on music page
  tracks.forEach(t => t.classList.remove('active'));
  const matchingCard = tracks.find(t => t.dataset.filename === trackData.filename);
  if (matchingCard) matchingCard.classList.add('active');

  isPlayerReady = false;
  queue[index] = trackData;
  currentTrackIndex = index;
  currentTrackFilename = trackData.filename;
  syncPlaybackOrderState(trackData.filename, { rebuild: rebuildOrder });
  if (Number.isInteger(playbackPosition) && playbackOrder[playbackPosition] === trackData.filename) {
    playbackOrderPosition = playbackPosition;
  }
  if (!lastHandledFinish || lastHandledFinish.filename !== trackData.filename) {
    lastHandledFinish = null;
  }
  playerLabelState = 'active';
  activeTrackChange = {
    id: changeId,
    source,
    index,
    fromFilename,
    track: trackData,
    shouldAutoplay,
    mediaRestoreApplied: false,
  };
  setNowPlayingTrack(trackData);
  syncMusicDetailPanel(trackData);

  Promise.resolve(stopActiveMediaForTransition(transitionAudio)).then(() => {
    if (!activeTrackChange || activeTrackChange.id !== changeId) return;

    wavesurfer.load(getTrackUrl(trackData.filename));
    if (shouldAutoplay) {
      attemptImmediatePlayback(changeId, transitionAudio);
    } else {
      restoreMediaAfterTransition(changeId, transitionAudio);
    }
  });

  wavesurfer.once('ready', () => {
    if (!activeTrackChange || activeTrackChange.id !== changeId) return;
    restoreMediaAfterTransition(changeId, transitionAudio);
    if (shouldAutoplay && !(wavesurfer.isPlaying && wavesurfer.isPlaying())) {
      const playPromise = wavesurfer.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('Ready-state playback fallback failed:', err && err.message ? err.message : err);
        });
      }
    }
    clearActiveTrackChange(changeId);
    refreshPlayerUI();
    updatePlayPauseLabel();
    syncActiveTrackCard();
    queueSavePlayerState();
  });
  queueSavePlayerState();
}

function playTrack(index, shouldAutoplay = true) {
  transitionToTrack(index, shouldAutoplay, 'playTrack', { rebuildOrder: true });
}

function nextTrack(source = 'manual-next') {
  const target = getPlaybackStepTarget(1, { wrap: repeatMode === 'all' });
  if (!target) return;
  transitionToTrack(target.index, true, source, { playbackPosition: target.position });
}

function prevTrack(source = 'manual-prev') {
  const target = getPlaybackStepTarget(-1, { wrap: repeatMode === 'all' });
  if (!target) return;
  transitionToTrack(target.index, true, source, { playbackPosition: target.position });
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
    shuffleToggleBtn,
    repeatToggleBtn,
    waveformEl
  } = getPlayerEls();

  if (!waveformEl || !playPauseBtn || !prevBtn || !nextBtn || !shuffleToggleBtn || !repeatToggleBtn || !volumeSlider || !currentTimeSpan || !durationSpan || !nowPlaying || !autoplayCheckbox) {
    return;
  }

  if (!wavesurfer) {
    wavesurfer = WaveSurfer.create({
      container: '#waveform',
      backend: 'MediaElement',
      waveColor: '#0ff',
      progressColor: '#a0a',
      height: 30,
      responsive: true,
      interact: true,
      dragToSeek: true
    });

    wavesurfer.on('ready', () => {
      isPlayerReady = true;
      prepareMediaElementForPlayback();
      durationSpan.textContent = formatTime(wavesurfer.getDuration());
      refreshPlayerUI();
      updatePlayPauseLabel();
    });

    wavesurfer.on('audioprocess', () => {
      currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seek', () => {
      currentTimeSpan.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      handleTrackFinish();
      refreshPlayerUI();
      updatePlayPauseLabel();
    });

    wavesurfer.on('play', () => {
      refreshPlayerUI();
      updatePlayPauseLabel();
    });
    wavesurfer.on('pause', () => {
      refreshPlayerUI();
      updatePlayPauseLabel();
    });
    
    // Handle track load errors (e.g., deleted files, 404s)
    wavesurfer.on('error', (err) => {
      console.error('WaveSurfer error:', err);

      const mediaFilename = getActiveMediaFilename();
      const failedTrack = activeTrackChange && activeTrackChange.track
        ? activeTrackChange.track
        : getCurrentTrackData();
      const failedFilename = mediaFilename || (failedTrack && failedTrack.filename ? failedTrack.filename : currentTrackFilename);

      if (shouldIgnoreWaveSurferError(failedFilename)) {
        console.warn('Ignoring stale WaveSurfer error for active track');
        playerLabelState = 'active';
        refreshPlayerUI();
        return;
      }
      
      // If current track failed to load, try next track or clear player
      if (failedFilename) {
        console.log(`Failed to load track: ${failedFilename}`);
        const failedIndex = removeTrackFromQueue(failedFilename);
        clearActiveTrackChange();
        
        if (failedIndex >= 0) {
          console.log('Removed failed track from queue');
        }
        
        // Try to play next track if available
        if (queue.length > 0 && currentTrackIndex >= 0 && currentTrackIndex < queue.length) {
          console.log('Attempting to play next track...');
          transitionToTrack(currentTrackIndex, autoplayEnabled, 'error-recovery');
        } else {
          // No valid tracks, clear player
          currentTrackFilename = null;
          currentTrackIndex = -1;
          playerLabelState = 'unavailable';
          refreshPlayerUI('Track unavailable');
          queueSavePlayerState();
        }
      }
    });
  }

  autoplayCheckbox.checked = autoplayEnabled;
  updatePlaybackModeControls();

  if (waveformEl.dataset.controlsBound !== 'true') {
    waveformEl.dataset.controlsBound = 'true';

    playPauseBtn.addEventListener('click', () => {
      if (!wavesurfer) return;
      if (!isPlayerReady && currentTrackIndex < 0 && queue.length > 0) {
        const startIndex = getInitialTrackIndex();
        if (startIndex >= 0) {
          playTrack(startIndex, true);
        }
        return;
      }
      wavesurfer.playPause();
      updatePlayPauseLabel();
      queueSavePlayerState();
    });

    prevBtn.addEventListener('click', prevTrack);
    nextBtn.addEventListener('click', nextTrack);
    shuffleToggleBtn.addEventListener('click', toggleShuffleMode);
    repeatToggleBtn.addEventListener('click', cycleRepeatMode);

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
    const title = (card.dataset.title || '').trim();
    const artist = (card.dataset.artist || '').trim();
    const album = (card.dataset.album || '').trim();
    const year = (card.dataset.year || '').trim();
    const description = (card.dataset.description || '').trim();
    const coverUrl = (card.dataset.coverUrl || '').trim();
    const coverAlt = (card.dataset.coverAlt || '').trim();
    const id = card.dataset.musicId || null; // if music_id is available
    
    if (filename) {
      queueData.push(normalizeTrack({ filename, title, artist, album, year, description, coverUrl, coverAlt, id }));
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
  
  // Do not replace an active queue just because filtered results rendered.
  // The visible archive can change independently from the currently playing queue.
  if (pageQueue.length > 0 && queue.length === 0 && !currentTrackFilename) {
    queue = pageQueue;
    queueSource = pageSource;
    syncPlaybackOrderState(null, { rebuild: true });
  }

  tracks.forEach((item, index) => {
    item.addEventListener('click', () => {
      queue = pageQueue.slice();
      queueSource = pageSource;
      playTrack(index, true);
    });
  });

  const playlistHeaders = document.querySelectorAll('.playlist-item .playlist-header');
  playlistHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const item = header.closest('.playlist-item');
      if (item) item.classList.toggle('expanded');
    });
  });

  // Sync current track index against the active queue without mutating it.
  if (currentTrackFilename && queue.length > 0) {
    const currentIndex = queue.findIndex((t) => t.filename === currentTrackFilename);
    if (currentIndex >= 0) {
      currentTrackIndex = currentIndex;
    }
  }
  syncPlaybackOrderState(currentTrackFilename);
  syncActiveTrackCard();
  syncMusicDetailPanel();
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

function initAdminBulkSelection() {
  const bulkRoots = document.querySelectorAll('[data-bulk-select-root]');

  bulkRoots.forEach((root) => {
    if (root.dataset.bulkBound === 'true') return;
    root.dataset.bulkBound = 'true';

    const startBtn = root.querySelector('[data-bulk-select-start]');
    const stopBtn = root.querySelector('[data-bulk-select-stop]');
    const form = root.querySelector('[data-bulk-delete-form]');
    const deleteBtn = root.querySelector('[data-bulk-delete-button]');
    const countEl = root.querySelector('[data-bulk-selection-count]');
    const checkboxes = Array.from(root.querySelectorAll('[data-bulk-select-checkbox]'));
    const modal = root.querySelector('[data-bulk-confirm-modal]');
    const modalCloseEls = modal ? Array.from(modal.querySelectorAll('[data-bulk-confirm-close], [data-bulk-confirm-cancel]')) : [];
    const modalTitleEl = modal ? modal.querySelector('[data-bulk-confirm-title]') : null;
    const modalMessageEl = modal ? modal.querySelector('[data-bulk-confirm-message]') : null;
    const modalConfirmBtn = modal ? modal.querySelector('[data-bulk-confirm-submit]') : null;
    const singularLabel = root.dataset.bulkLabelSingular || 'item';
    const pluralLabel = root.dataset.bulkLabelPlural || 'items';
    let isSelectionMode = false;
    let lastTrigger = null;

    if (!startBtn || !stopBtn || !form || !deleteBtn || !countEl || !checkboxes.length || !modal || !modalTitleEl || !modalMessageEl || !modalConfirmBtn) {
      return;
    }

    function getSelectedCount() {
      return checkboxes.filter((checkbox) => checkbox.checked).length;
    }

    function updateSelectedItems() {
      checkboxes.forEach((checkbox) => {
        const item = checkbox.closest('[data-bulk-select-item]');
        if (!item) return;
        item.classList.toggle('is-bulk-selected', checkbox.checked);
      });
    }

    function syncState() {
      const selectedCount = getSelectedCount();
      root.classList.toggle('is-selection-mode', isSelectionMode);
      stopBtn.hidden = !isSelectionMode;
      form.hidden = !isSelectionMode;
      deleteBtn.disabled = selectedCount === 0;
      countEl.textContent = `${selectedCount} ${selectedCount === 1 ? singularLabel : pluralLabel} selected`;
      updateSelectedItems();

      if (!isSelectionMode) {
        root.querySelectorAll('.membership-panel').forEach((panel) => {
          panel.style.display = 'none';
        });
      }
    }

    function clearSelection() {
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
      updateSelectedItems();
    }

    function getSelectedLabel(selectedCount) {
      return selectedCount === 1 ? singularLabel : pluralLabel;
    }

    function closeModal(restoreFocus = true) {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');

      if (restoreFocus && lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
    }

    function openModal(triggerEl = null) {
      const selectedCount = getSelectedCount();
      if (selectedCount === 0) {
        return;
      }

      lastTrigger = triggerEl || deleteBtn;
      modalTitleEl.textContent = `Delete ${selectedCount} selected ${getSelectedLabel(selectedCount)}?`;
      modalMessageEl.textContent = `You are about to permanently delete ${selectedCount} selected ${getSelectedLabel(selectedCount)}. This cannot be undone.`;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      modalConfirmBtn.focus();
    }

    function submitConfirmedBulkDelete() {
      form.dataset.bulkConfirming = 'true';
      closeModal(false);
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    }

    startBtn.addEventListener('click', () => {
      isSelectionMode = true;
      syncState();
    });

    stopBtn.addEventListener('click', () => {
      isSelectionMode = false;
      closeModal(false);
      clearSelection();
      syncState();
    });

    deleteBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (deleteBtn.disabled) return;
      openModal(deleteBtn);
    });

    modalCloseEls.forEach((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        closeModal();
      });
    });

    modalConfirmBtn.addEventListener('click', (event) => {
      event.preventDefault();
      submitConfirmedBulkDelete();
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (modal.hidden) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      }
    });

    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        syncState();
      });

      const item = checkbox.closest('[data-bulk-select-item]');
      if (!item) return;

      item.addEventListener('click', (event) => {
        if (!isSelectionMode) return;
        if (event.target.closest('a, button, input, select, textarea, label, form')) return;
        checkbox.checked = !checkbox.checked;
        syncState();
      });
    });

    form.addEventListener('submit', (event) => {
      const selectedCount = getSelectedCount();
      if (selectedCount === 0) {
        event.preventDefault();
        return;
      }

      if (form.dataset.bulkConfirming === 'true') {
        form.dataset.bulkConfirming = 'false';
        return;
      }

      event.preventDefault();
      openModal(deleteBtn);
    });

    form.addEventListener('reset', () => {
      closeModal(false);
    });

    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target === deleteBtn) {
        event.preventDefault();
        if (!deleteBtn.disabled) {
          openModal(deleteBtn);
        }
      }
    });

    syncState();
  });
}

function initAdminUploadProgress() {
  const uploadForms = document.querySelectorAll('[data-upload-progress-form]');

  uploadForms.forEach((form) => {
    if (form.dataset.uploadProgressBound === 'true') return;
    form.dataset.uploadProgressBound = 'true';

    const feedback = form.querySelector('[data-upload-feedback]');
    const titleEl = form.querySelector('[data-upload-feedback-title]');
    const phaseEl = form.querySelector('[data-upload-feedback-phase]');
    const barEl = form.querySelector('[data-upload-feedback-bar]');
    const percentEl = form.querySelector('[data-upload-feedback-percent]');
    const detailEl = form.querySelector('[data-upload-feedback-detail]');
    const processingWrap = form.querySelector('[data-upload-feedback-processing]');
    const processingTextEl = form.querySelector('[data-upload-feedback-processing-text]');
    const errorEl = form.querySelector('[data-upload-feedback-error]');
    const submitButtons = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
    const audioInput = form.querySelector('input[type="file"][name="file"], input[type="file"][name="files"]');

    if (!feedback || !titleEl || !phaseEl || !barEl || !percentEl || !detailEl || !processingWrap || !processingTextEl || !errorEl || !submitButtons.length || !audioInput) {
      return;
    }

    const originalButtonLabels = new Map();
    submitButtons.forEach((button) => {
      originalButtonLabels.set(button, button.tagName === 'INPUT' ? button.value : button.textContent);
    });

    function setSubmitButtonState(disabled, label) {
      submitButtons.forEach((button) => {
        button.disabled = disabled;
        if (label) {
          if (button.tagName === 'INPUT') {
            button.value = label;
          } else {
            button.textContent = label;
          }
        } else {
          const original = originalButtonLabels.get(button);
          if (button.tagName === 'INPUT') {
            button.value = original;
          } else {
            button.textContent = original;
          }
        }
      });
    }

    function resetError() {
      feedback.classList.remove('is-error');
      errorEl.hidden = true;
      errorEl.textContent = '';
    }

    function setProgressState(options) {
      const {
        title,
        phase,
        percent,
        detail,
        showProcessing,
        processingText,
      } = options;

      feedback.hidden = false;
      feedback.removeAttribute('hidden');
      if (title) titleEl.textContent = title;
      if (phase) phaseEl.textContent = phase;
      if (typeof percent === 'number') {
        const safePercent = Math.max(0, Math.min(100, percent));
        barEl.style.width = `${safePercent}%`;
        percentEl.textContent = `${Math.round(safePercent)}%`;
      }
      if (detail) detailEl.textContent = detail;
      processingWrap.hidden = !showProcessing;
      if (processingText) processingTextEl.textContent = processingText;
    }

    function showError(message) {
      feedback.hidden = false;
      feedback.classList.add('is-error');
      processingWrap.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = message;
    }

    function getSelectedFiles() {
      return Array.from(audioInput.files || []).filter(Boolean);
    }

    function getSelectedFileSummary() {
      const files = getSelectedFiles();
      const singularLabel = form.dataset.uploadFilesLabelSingular || 'file';
      const pluralLabel = form.dataset.uploadFilesLabelPlural || 'files';
      if (!files.length) {
        return `0 ${pluralLabel}`;
      }
      if (files.length === 1) {
        return files[0].name;
      }
      return `${files.length} ${files.length === 1 ? singularLabel : pluralLabel}`;
    }

    function hasWavSelection() {
      return getSelectedFiles().some((file) => /\.(wav|wave)$/i.test(file.name || '') || /audio\/(wav|wave|x-wav|vnd\.wave)$/i.test(file.type || ''));
    }

    form.addEventListener('submit', (event) => {
      if (form.dataset.uploadInFlight === 'true') {
        event.preventDefault();
        return;
      }

      if (!window.XMLHttpRequest || !window.FormData) {
        return;
      }

      event.preventDefault();
      resetError();

      const selectedFiles = getSelectedFiles();
      if (!selectedFiles.length) {
        showError('Select at least one audio file before uploading.');
        return;
      }

      const isBatch = selectedFiles.length > 1 || audioInput.hasAttribute('multiple');
      const fileSummary = getSelectedFileSummary();
      const processingLabel = hasWavSelection()
        ? (form.dataset.uploadProcessingLabelWav || 'Upload complete. Converting audio to MP3...')
        : (form.dataset.uploadProcessingLabel || 'Upload complete. Processing upload...');

      form.dataset.uploadInFlight = 'true';
      form.setAttribute('aria-busy', 'true');
      setSubmitButtonState(true, 'Uploading...');
      setProgressState({
        title: isBatch ? 'Uploading batch' : 'Uploading track',
        phase: 'Uploading',
        percent: 0,
        detail: isBatch ? `Starting upload for ${fileSummary}.` : `Starting upload for ${fileSummary}.`,
        showProcessing: false,
      });

      const xhr = new XMLHttpRequest();
      xhr.open((form.method || 'POST').toUpperCase(), form.action, true);
      xhr.responseType = 'text';
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = 10 * 60 * 1000;

      xhr.upload.addEventListener('progress', (progressEvent) => {
        if (progressEvent.lengthComputable && progressEvent.total > 0) {
          const percent = (progressEvent.loaded / progressEvent.total) * 100;
          setProgressState({
            title: isBatch ? 'Uploading batch' : 'Uploading track',
            phase: 'Uploading',
            percent,
            detail: isBatch
              ? `Uploading ${fileSummary}.`
              : `Uploading ${fileSummary}.`,
            showProcessing: false,
          });
        } else {
          setProgressState({
            title: isBatch ? 'Uploading batch' : 'Uploading track',
            phase: 'Uploading',
            percent: 10,
            detail: isBatch ? `Uploading ${fileSummary}...` : `Uploading ${fileSummary}...`,
            showProcessing: false,
          });
        }
      });

      xhr.upload.addEventListener('load', () => {
        setSubmitButtonState(true, 'Processing...');
        setProgressState({
          title: hasWavSelection() ? 'Converting audio' : 'Finalising upload',
          phase: 'Processing',
          percent: 100,
          detail: processingLabel,
          showProcessing: true,
          processingText: processingLabel,
        });
      });

      xhr.addEventListener('load', () => {
        form.dataset.uploadInFlight = 'false';
        form.removeAttribute('aria-busy');

        let payload = null;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (err) {
          payload = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && payload && payload.ok && payload.redirectTo) {
          window.location.assign(payload.redirectTo);
          return;
        }

        setSubmitButtonState(false);
        const message = payload && payload.error
          ? payload.error
          : 'Upload failed before the server could finish processing.';
        setProgressState({
          title: 'Upload failed',
          phase: 'Error',
          percent: Math.min(100, parseInt(percentEl.textContent, 10) || 0),
          detail: 'You can correct the issue and try again.',
          showProcessing: false,
        });
        showError(message);
      });

      xhr.addEventListener('error', () => {
        form.dataset.uploadInFlight = 'false';
        form.removeAttribute('aria-busy');
        setSubmitButtonState(false);
        setProgressState({
          title: 'Upload failed',
          phase: 'Connection error',
          percent: Math.min(100, parseInt(percentEl.textContent, 10) || 0),
          detail: 'The connection dropped before the upload finished.',
          showProcessing: false,
        });
        showError('The upload could not be completed. Check your connection and try again.');
      });

      xhr.addEventListener('timeout', () => {
        form.dataset.uploadInFlight = 'false';
        form.removeAttribute('aria-busy');
        setSubmitButtonState(false);
        setProgressState({
          title: 'Upload timed out',
          phase: 'Timed out',
          percent: Math.min(100, parseInt(percentEl.textContent, 10) || 0),
          detail: 'The server took too long to finish processing this upload.',
          showProcessing: false,
        });
        showError('The upload timed out while the server was processing it. Please try again.');
      });

      xhr.addEventListener('abort', () => {
        form.dataset.uploadInFlight = 'false';
        form.removeAttribute('aria-busy');
        setSubmitButtonState(false);
        setProgressState({
          title: 'Upload cancelled',
          phase: 'Cancelled',
          percent: Math.min(100, parseInt(percentEl.textContent, 10) || 0),
          detail: 'The upload was cancelled before completion.',
          showProcessing: false,
        });
        showError('The upload was cancelled.');
      });

      xhr.send(new FormData(form));
    });
  });
}

function initPageFeatures() {
  if (window.applyCsrfProtection) {
    window.applyCsrfProtection(document);
  }
  bindPlayerControls();
  initFullReloadPersistence();
  initMusicPageFeatures();
  initVideoControls();
  initGalleryLightbox();
  initAdminMembershipToggles();
  initAdminBulkSelection();
  initAdminUploadProgress();
  refreshPlayerUI();
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

  if (method === 'GET') {
    const actionUrl = new URL(action, window.location.origin);
    const params = new URLSearchParams(new FormData(form));
    actionUrl.search = params.toString();
    await softNavigate(actionUrl.toString());
    return;
  }

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

    // Bulk delete uses explicit full-page submission after modal confirmation.
    if (form.matches('[data-bulk-delete-form]')) return;
    
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
