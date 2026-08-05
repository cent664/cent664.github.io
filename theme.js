(function () {
  var STORAGE_KEY = 'theme';
  var WALLPAPER_INDEX_KEY = 'wallpaper-index';
  var WALLPAPER_FILE_KEY = 'wallpaper-file';
  var WALLPAPER_PAUSED_KEY = 'wallpaper-paused';
  var WALLPAPER_INTERVAL_MS = 12000;
  var WALLPAPER_FADE_MS = 900;
  var EMAIL_COPY_TEXT = 'adg002 at gmail dot com';
  var DEFAULT_WALLPAPERS = [
    'IMG_2796.webp',
    'IMG_2802.webp',
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
  var wallpaperHistory = [];
  var wallpaperPaused = false;
  var wallpaperManifestLoaded = false;
  var activeLayer = 'a';
  var showRequestId = 0;
  var fadeTimeout = null;
  var queuedNextIndex = -1;
  var imageCache = Object.create(null);
  var allPreloadStarted = false;
  var toastTimer = null;

  function preferredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'wallpaper') return saved;
    } catch (e) {}
    return 'wallpaper';
  }

  function nextTheme(current) {
    if (current === 'dark') return 'light';
    if (current === 'light') return 'wallpaper';
    return 'dark';
  }

  function themeLabel(theme) {
    if (theme === 'light') return 'Switch to wallpaper mode';
    if (theme === 'wallpaper') return 'Switch to dark mode';
    return 'Switch to light mode';
  }

  function assetBase() {
    return /\/research\//.test(window.location.pathname) ? '../assets/' : 'assets/';
  }

  function wallpaperUrl(filename) {
    return assetBase() + 'wallpapers/' + encodeURIComponent(filename);
  }

  function reduceMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

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

  function persistWallpaperState() {
    try {
      localStorage.setItem(WALLPAPER_INDEX_KEY, String(wallpaperIndex));
      if (wallpaperList[wallpaperIndex]) {
        localStorage.setItem(WALLPAPER_FILE_KEY, wallpaperList[wallpaperIndex]);
      }
      localStorage.setItem(WALLPAPER_PAUSED_KEY, wallpaperPaused ? '1' : '0');
    } catch (e) {}
  }

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

  function updatePauseButton() {
    var btn = document.querySelector('[data-wallpaper-action="pause"]');
    if (!btn) return;
    btn.classList.toggle('is-paused', wallpaperPaused);
    btn.setAttribute(
      'aria-label',
      wallpaperPaused ? 'Play wallpaper slideshow' : 'Pause wallpaper slideshow'
    );
  }

  function setWallpaperControlsVisible(visible) {
    var controls = document.querySelector('.wallpaper-controls');
    var stage = document.querySelector('.wallpaper-stage');
    if (controls) controls.hidden = !visible;
    if (stage) stage.classList.toggle('is-active', !!visible);
  }

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

  function pickRandomIndex(exclude) {
    if (wallpaperList.length <= 1) return 0;
    var next = exclude;
    while (next === exclude) {
      next = Math.floor(Math.random() * wallpaperList.length);
    }
    return next;
  }

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

  function preloadAllWallpapers() {
    if (allPreloadStarted) return;
    allPreloadStarted = true;
    var i;
    for (i = 0; i < wallpaperList.length; i += 1) {
      loadWallpaperImage(wallpaperList[i]);
    }
  }

  function stopWallpaperCycle() {
    if (wallpaperTimer) {
      clearInterval(wallpaperTimer);
      wallpaperTimer = null;
    }
  }

  function scheduleWallpaperCycle() {
    stopWallpaperCycle();
    if (wallpaperPaused || wallpaperList.length < 2) return;
    if (document.documentElement.getAttribute('data-theme') !== 'wallpaper') return;
    wallpaperTimer = setInterval(function () {
      goRandomWallpaper(true);
    }, WALLPAPER_INTERVAL_MS);
  }

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

  function pushHistory(filename) {
    if (!filename) return;
    if (wallpaperHistory.length && wallpaperHistory[wallpaperHistory.length - 1] === filename) return;
    wallpaperHistory.push(filename);
    if (wallpaperHistory.length > 40) wallpaperHistory.shift();
  }

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

  function normalizeWallpaperList(data) {
    if (!Array.isArray(data)) return [];
    return data
      .filter(function (name) { return typeof name === 'string' && name.trim(); })
      .map(function (name) { return name.trim(); });
  }

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

  window.__applyTheme = applyTheme;
  window.__toggleTheme = toggleTheme;
  applyTheme(preferredTheme());

  window.addEventListener('load', function () {
    window.requestAnimationFrame(enableTransitions);
  });

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
