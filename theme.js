/**
 * Site UI script: dark / light / wallpaper theme cycling, wallpaper slideshow
 * (crossfade + preload + history), mobile nav, and contact email copy.
 * Loaded on every page after the markup; head scripts handle first-paint theme.
 */
(function () {
  /* === Constants / state ============================================== */

  var STORAGE_KEY = 'theme';
  var WALLPAPER_INDEX_KEY = 'wallpaper-index';
  var WALLPAPER_FILE_KEY = 'wallpaper-file';
  var WALLPAPER_PAUSED_KEY = 'wallpaper-paused';
  var WALLPAPER_INTERVAL_MS = 12000; // auto-advance interval in wallpaper mode
  var WALLPAPER_FADE_MS = 900;       // must match CSS opacity transition
  var EMAIL_COPY_TEXT = 'adg002 at gmail dot com'; // obfuscated; not a real mailto
  // Fallback list if manifest.json fails; optimize_wallpapers.py keeps this in sync.
  var DEFAULT_WALLPAPERS = [
    'IMG_2796.webp',
    'IMG_2802.webp',
    'PXL_20250123_231852312.webp',
    'PXL_20250212_132037666.webp',
    'PXL_20250524_003208344.webp',
    'PXL_20250717_085115011.webp',
    'PXL_20250813_235625089.webp',
    'PXL_20250919_235734506.webp',
    'PXL_20251015_225909617.webp',
    'PXL_20251213_212702761.webp',
    'PXL_20251228_232419184.webp',
    'PXL_20260319_154558385.webp',
    'PXL_20260319_155321448.webp',
    'PXL_20260409_002746478.webp',
    'PXL_20260604_224807912.webp',
    'PXL_20260719_023300571.webp',
    'PXL_20260719_023859037.webp',
    'PXL_20260719_032554055.webp',
    'PXL_20260731_222044010.webp'
  ];

  var wallpaperTimer = null;
  var wallpaperList = DEFAULT_WALLPAPERS.slice();
  var wallpaperIndex = 0;
  var wallpaperHistory = []; // filenames for "previous" button
  var wallpaperPaused = false;
  var wallpaperManifestLoaded = false;
  var activeLayer = 'a';     // which of the two crossfade layers is on top
  var showRequestId = 0;     // bumps on each show; stale loads/fades ignore themselves
  var fadeTimeout = null;    // clears outgoing layer after fade completes
  var queuedNextIndex = -1;  // pre-picked random target, warmed in cache
  var imageCache = Object.create(null);
  var allPreloadStarted = false;
  var toastTimer = null;

  /* === Theme helpers ================================================== */

  /** Saved theme, or wallpaper for first-time visitors. */
  function preferredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'wallpaper') return saved;
    } catch (e) {}
    return 'wallpaper';
  }

  /** Cycle order: dark → light → wallpaper → dark. */
  function nextTheme(current) {
    if (current === 'dark') return 'light';
    if (current === 'light') return 'wallpaper';
    return 'dark';
  }

  /** Accessible label for the theme toggle (describes the next mode). */
  function themeLabel(theme) {
    if (theme === 'light') return 'Switch to wallpaper mode';
    if (theme === 'wallpaper') return 'Switch to dark mode';
    return 'Switch to light mode';
  }

  /** Asset path prefix: research pages live one folder deeper. */
  function assetBase() {
    return /\/research\//.test(window.location.pathname) ? '../assets/' : 'assets/';
  }

  function wallpaperUrl(filename) {
    return assetBase() + 'wallpapers/' + encodeURIComponent(filename);
  }

  /** Respect OS "reduce motion" — skip crossfade animation. */
  function reduceMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /* === Wallpaper persistence ========================================== */

  /** Prefer filename match so list reorders don't break the current image. */
  function readStoredIndex() {
    try {
      var file = localStorage.getItem(WALLPAPER_FILE_KEY);
      if (file) {
        var byName = wallpaperList.indexOf(file);
        if (byName >= 0) return byName;
      }
      var raw = localStorage.getItem(WALLPAPER_INDEX_KEY);
      var idx = parseInt(raw, 10);
      if (!isNaN(idx) && idx >= 0 && idx < wallpaperList.length) return idx;
    } catch (e) {}
    return -1;
  }

  function readPaused() {
    try {
      return localStorage.getItem(WALLPAPER_PAUSED_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  /** Keep slideshow position/pause across page navigations. */
  function persistWallpaperState() {
    try {
      localStorage.setItem(WALLPAPER_INDEX_KEY, String(wallpaperIndex));
      if (wallpaperList[wallpaperIndex]) {
        localStorage.setItem(WALLPAPER_FILE_KEY, wallpaperList[wallpaperIndex]);
      }
      localStorage.setItem(WALLPAPER_PAUSED_KEY, wallpaperPaused ? '1' : '0');
    } catch (e) {}
  }

  /* === Wallpaper UI =================================================== */

  /** Create the fixed two-layer stage once; bind prev/pause/next controls. */
  function ensureWallpaperUi() {
    if (!document.querySelector('.wallpaper-stage')) {
      var stage = document.createElement('div');
      stage.className = 'wallpaper-stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML =
        '<div class="wallpaper-layer" data-layer="a"></div>' +
        '<div class="wallpaper-layer" data-layer="b"></div>' +
        '<div class="wallpaper-scrim"></div>';
      document.body.insertBefore(stage, document.body.firstChild);
    }

    var controls = document.querySelector('.wallpaper-controls');
    if (controls && !controls.dataset.bound) {
      controls.dataset.bound = '1';
      controls.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-wallpaper-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-wallpaper-action');
        if (action === 'prev') goPreviousWallpaper(true);
        else if (action === 'next') goRandomWallpaper(true);
        else if (action === 'pause') toggleWallpaperPause();
      });
    }
  }

  /** Swap pause/play icon and aria-label to match current state. */
  function updatePauseButton() {
    var btn = document.querySelector('[data-wallpaper-action="pause"]');
    if (!btn) return;
    btn.classList.toggle('is-paused', wallpaperPaused);
    btn.setAttribute(
      'aria-label',
      wallpaperPaused ? 'Play wallpaper slideshow' : 'Pause wallpaper slideshow'
    );
  }

  /** Show/hide controls and activate the stage only in wallpaper mode. */
  function setWallpaperControlsVisible(visible) {
    var controls = document.querySelector('.wallpaper-controls');
    var stage = document.querySelector('.wallpaper-stage');
    if (controls) controls.hidden = !visible;
    if (stage) stage.classList.toggle('is-active', !!visible);
  }

  /* === Image loading / preload ======================================== */

  /**
   * Load (or reuse) an Image so we never fade in before pixels are ready.
   * callback(true|false) runs once when load succeeds or fails.
   */
  function loadWallpaperImage(filename, callback) {
    if (!filename) {
      if (callback) callback(false);
      return;
    }

    var cached = imageCache[filename];
    if (cached && cached.complete && cached.naturalWidth > 0) {
      if (callback) callback(true);
      return;
    }

    var img = cached || new Image();
    imageCache[filename] = img;

    var settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      if (callback) callback(ok);
    }

    img.onload = function () { done(true); };
    img.onerror = function () { done(false); };

    if (img.complete && img.naturalWidth > 0) {
      done(true);
      return;
    }

    // Re-assigning src is fine if already loading the same URL.
    img.src = wallpaperUrl(filename);
  }

  /** Random index that is not `exclude` (used for next / empty history). */
  function pickRandomIndex(exclude) {
    if (wallpaperList.length <= 1) return 0;
    var next = exclude;
    while (next === exclude) {
      next = Math.floor(Math.random() * wallpaperList.length);
    }
    return next;
  }

  /** Pre-pick and warm the next forward image (and last history entry). */
  function ensureQueuedNext() {
    if (wallpaperList.length < 2) {
      queuedNextIndex = -1;
      return;
    }
    if (queuedNextIndex < 0 || queuedNextIndex === wallpaperIndex) {
      queuedNextIndex = pickRandomIndex(wallpaperIndex);
    }
    loadWallpaperImage(wallpaperList[queuedNextIndex]);
    if (wallpaperHistory.length) {
      loadWallpaperImage(wallpaperHistory[wallpaperHistory.length - 1]);
    }
  }

  /** Background-warm the whole set once so later clicks stay snappy. */
  function preloadAllWallpapers() {
    if (allPreloadStarted) return;
    allPreloadStarted = true;
    var i;
    for (i = 0; i < wallpaperList.length; i += 1) {
      loadWallpaperImage(wallpaperList[i]);
    }
  }

  /* === Transitions / navigation ======================================= */

  function stopWallpaperCycle() {
    if (wallpaperTimer) {
      clearInterval(wallpaperTimer);
      wallpaperTimer = null;
    }
  }

  /** Restart the auto-advance timer (no-op if paused or not in wallpaper mode). */
  function scheduleWallpaperCycle() {
    stopWallpaperCycle();
    if (wallpaperPaused || wallpaperList.length < 2) return;
    if (document.documentElement.getAttribute('data-theme') !== 'wallpaper') return;
    wallpaperTimer = setInterval(function () {
      goRandomWallpaper(true);
    }, WALLPAPER_INTERVAL_MS);
  }

  /**
   * Crossfade (or snap) to filename on the inactive layer.
   * Invariants: wait for image load first; showRequestId drops superseded work
   * so rapid clicks cannot clear the wrong layer's background (black flash).
   */
  function showWallpaper(filename, animate) {
    ensureWallpaperUi();
    var stage = document.querySelector('.wallpaper-stage');
    if (!stage || !filename) return;

    var requestId = (showRequestId += 1);
    if (fadeTimeout) {
      clearTimeout(fadeTimeout);
      fadeTimeout = null;
    }

    loadWallpaperImage(filename, function () {
      if (requestId !== showRequestId) return;
      if (document.documentElement.getAttribute('data-theme') !== 'wallpaper') return;

      var url = 'url("' + wallpaperUrl(filename) + '")';
      var nextId = activeLayer === 'a' ? 'b' : 'a';
      var currentEl = stage.querySelector('[data-layer="' + activeLayer + '"]');
      var nextEl = stage.querySelector('[data-layer="' + nextId + '"]');
      if (!currentEl || !nextEl) return;

      nextEl.style.backgroundImage = url;

      if (!animate || reduceMotion() || !currentEl.classList.contains('is-visible')) {
        nextEl.classList.add('is-visible');
        currentEl.classList.remove('is-visible');
        currentEl.style.backgroundImage = '';
        activeLayer = nextId;
        ensureQueuedNext();
        preloadAllWallpapers();
        return;
      }

      nextEl.classList.add('is-visible');
      currentEl.classList.remove('is-visible');
      activeLayer = nextId;

      var outgoing = currentEl;
      fadeTimeout = window.setTimeout(function () {
        fadeTimeout = null;
        if (requestId !== showRequestId) return;
        if (!outgoing.classList.contains('is-visible')) {
          outgoing.style.backgroundImage = '';
        }
      }, WALLPAPER_FADE_MS);

      ensureQueuedNext();
      preloadAllWallpapers();
    });
  }

  /** Record current image so "previous" can walk back. */
  function pushHistory(filename) {
    if (!filename) return;
    if (wallpaperHistory.length && wallpaperHistory[wallpaperHistory.length - 1] === filename) return;
    wallpaperHistory.push(filename);
    if (wallpaperHistory.length > 40) wallpaperHistory.shift();
  }

  /** Right arrow / auto-advance: go to a different random (prefer queued). */
  function goRandomWallpaper(animate) {
    if (!wallpaperList.length) return;
    if (wallpaperList.length === 1) {
      showWallpaper(wallpaperList[0], animate);
      return;
    }

    var current = wallpaperList[wallpaperIndex];
    pushHistory(current);

    var nextIndex = queuedNextIndex;
    if (nextIndex < 0 || nextIndex === wallpaperIndex) {
      nextIndex = pickRandomIndex(wallpaperIndex);
    }
    queuedNextIndex = -1;

    wallpaperIndex = nextIndex;
    persistWallpaperState();
    showWallpaper(wallpaperList[wallpaperIndex], animate);
    if (!wallpaperPaused) scheduleWallpaperCycle();
  }

  /** Left arrow: pop history; if empty, behave like random next. */
  function goPreviousWallpaper(animate) {
    if (!wallpaperList.length) return;

    while (wallpaperHistory.length) {
      var prevFile = wallpaperHistory.pop();
      var idx = wallpaperList.indexOf(prevFile);
      if (idx >= 0 && idx !== wallpaperIndex) {
        // Current image becomes the next forward target if they press next again.
        queuedNextIndex = wallpaperIndex;
        wallpaperIndex = idx;
        persistWallpaperState();
        showWallpaper(wallpaperList[wallpaperIndex], animate);
        if (!wallpaperPaused) scheduleWallpaperCycle();
        return;
      }
    }

    // No history yet — pick a different random image.
    goRandomWallpaper(animate);
  }

  function toggleWallpaperPause() {
    wallpaperPaused = !wallpaperPaused;
    persistWallpaperState();
    updatePauseButton();
    if (wallpaperPaused) stopWallpaperCycle();
    else scheduleWallpaperCycle();
  }

  /** Enter wallpaper mode: restore saved image (or pick random) and start timer. */
  function startWallpaperCycle() {
    ensureWallpaperUi();
    setWallpaperControlsVisible(true);
    wallpaperPaused = readPaused();
    updatePauseButton();

    if (!wallpaperList.length) {
      setWallpaperControlsVisible(false);
      return;
    }

    var stored = readStoredIndex();
    if (stored >= 0) wallpaperIndex = stored;
    else wallpaperIndex = Math.floor(Math.random() * wallpaperList.length);

    persistWallpaperState();
    showWallpaper(wallpaperList[wallpaperIndex], false);
    scheduleWallpaperCycle();
  }

  function stopWallpaperMode() {
    stopWallpaperCycle();
    setWallpaperControlsVisible(false);
  }

  /* === Manifest / theme apply ========================================= */

  function normalizeWallpaperList(data) {
    if (!Array.isArray(data)) return [];
    return data
      .filter(function (name) { return typeof name === 'string' && name.trim(); })
      .map(function (name) { return name.trim(); });
  }

  /** Fetch manifest once; on failure keep DEFAULT_WALLPAPERS. */
  function loadWallpaperManifest(callback) {
    if (wallpaperManifestLoaded) {
      callback();
      return;
    }
    var req = new XMLHttpRequest();
    req.open('GET', assetBase() + 'wallpapers/manifest.json', true);
    req.onload = function () {
      wallpaperManifestLoaded = true;
      if (req.status >= 200 && req.status < 300) {
        try {
          var parsed = normalizeWallpaperList(JSON.parse(req.responseText));
          if (parsed.length) wallpaperList = parsed;
        } catch (e) {}
      }
      callback();
    };
    req.onerror = function () {
      wallpaperManifestLoaded = true;
      callback();
    };
    req.send();
  }

  /** Apply data-theme and start/stop wallpaper machinery. */
  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'wallpaper') theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.setAttribute('aria-label', themeLabel(theme));

    if (theme === 'wallpaper') {
      loadWallpaperManifest(startWallpaperCycle);
    } else {
      stopWallpaperMode();
    }
  }

  /** Enable CSS theme transitions after first paint (avoids flash on load). */
  function enableTransitions() {
    document.documentElement.classList.add('theme-transitions');
  }

  function toggleTheme() {
    enableTransitions();
    var next = nextTheme(document.documentElement.getAttribute('data-theme'));
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {}
    applyTheme(next);
  }

  /* === Email copy + toast ============================================= */

  function showToast(message) {
    var toast = document.getElementById('site-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'site-toast';
      toast.className = 'site-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 2200);
  }

  /** Copy obfuscated email text (no mailto: in the page source). */
  function copyEmailText() {
    var text = EMAIL_COPY_TEXT;
    function onSuccess() {
      showToast('Email was copied to clipboard');
    }
    function onFail() {
      showToast('Could not copy email');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(function () {
        fallbackCopy(text, onSuccess, onFail);
      });
      return;
    }
    fallbackCopy(text, onSuccess, onFail);
  }

  /** Older-browser clipboard fallback via a temporary textarea. */
  function fallbackCopy(text, onSuccess, onFail) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try {
      if (document.execCommand('copy')) onSuccess();
      else onFail();
    } catch (e) {
      onFail();
    }
    document.body.removeChild(area);
  }

  /** Wire the contact email card to copy-on-click / Enter / Space. */
  function initEmailCopy() {
    var emailBtn = document.querySelector('.contact-card--email');
    if (!emailBtn) return;
    emailBtn.setAttribute('role', 'button');
    emailBtn.setAttribute('tabindex', '0');
    emailBtn.setAttribute('aria-label', 'Copy email address');
    emailBtn.addEventListener('click', function () {
      copyEmailText();
    });
    emailBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyEmailText();
      }
    });
  }

  /* Expose for the early head bootstrap + theme toggle button onclick. */
  window.__applyTheme = applyTheme;
  window.__toggleTheme = toggleTheme;
  applyTheme(preferredTheme());

  window.addEventListener('load', function () {
    window.requestAnimationFrame(enableTransitions);
  });

  /* === Nav + boot ===================================================== */

  /** Hamburger menu: open/close, outside click, Escape, and desktop resize. */
  function initNav() {
    var header = document.querySelector('header');
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('primary-nav');
    if (!header || !toggle || !nav) return;

    var mq = window.matchMedia('(max-width: 860px), (hover: none) and (pointer: coarse)');

    function closeNav() {
      header.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }

    toggle.addEventListener('click', function () {
      if (header.classList.contains('nav-open')) closeNav();
      else {
        header.classList.add('nav-open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Close menu');
      }
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeNav();
    });

    document.addEventListener('click', function (e) {
      if (!header.classList.contains('nav-open')) return;
      if (!header.contains(e.target)) closeNav();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    mq.addEventListener('change', function () {
      if (!mq.matches) closeNav();
    });
  }

  /** After DOM is ready: stage, nav, email, and sync wallpaper chrome. */
  function bootUi() {
    ensureWallpaperUi();
    initNav();
    initEmailCopy();
    if (document.documentElement.getAttribute('data-theme') === 'wallpaper') {
      setWallpaperControlsVisible(true);
      updatePauseButton();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootUi);
  } else {
    bootUi();
  }
})();
