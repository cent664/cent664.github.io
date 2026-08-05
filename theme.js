(function () {
  var STORAGE_KEY = 'theme';
  var WALLPAPER_INDEX_KEY = 'wallpaper-index';
  var WALLPAPER_FILE_KEY = 'wallpaper-file';
  var WALLPAPER_PAUSED_KEY = 'wallpaper-paused';
  var WALLPAPER_INTERVAL_MS = 12000;
  var WALLPAPER_FADE_MS = 900;
  var EMAIL_COPY_TEXT = 'adg002 at gmail dot com';
  var DEFAULT_WALLPAPERS = [
    'PXL_20260319_154558385.jpg',
    'PXL_20260319_155321448.jpg',
    'PXL_20260409_002746478.jpg',
    'PXL_20260604_224807912.jpg',
    'PXL_20260719_023300571.jpg',
    'PXL_20260719_023859037.jpg',
    'PXL_20260719_032554055.jpg',
    'PXL_20260731_222044010.jpg',
    'IMG_2796.JPG',
    'IMG_2802.JPG'
  ];

  var wallpaperTimer = null;
  var wallpaperList = DEFAULT_WALLPAPERS.slice();
  var wallpaperIndex = 0;
  var wallpaperPaused = false;
  var wallpaperManifestLoaded = false;
  var activeLayer = 'a';
  var fadeLocked = false;
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

    if (!document.querySelector('.wallpaper-controls')) {
      var footer = document.querySelector('footer');
      if (!footer || !footer.parentNode) return;
      var controls = document.createElement('div');
      controls.className = 'wallpaper-controls';
      controls.hidden = true;
      controls.innerHTML =
        '<button type="button" class="wallpaper-control-btn" data-wallpaper-action="prev" aria-label="Previous wallpaper">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>' +
        '</button>' +
        '<button type="button" class="wallpaper-control-btn" data-wallpaper-action="pause" aria-label="Pause wallpaper slideshow">' +
          '<svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>' +
          '<svg class="icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="8,5 19,12 8,19"></polygon></svg>' +
        '</button>' +
        '<button type="button" class="wallpaper-control-btn" data-wallpaper-action="next" aria-label="Next wallpaper">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
        '</button>';
      footer.parentNode.insertBefore(controls, footer);

      controls.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-wallpaper-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-wallpaper-action');
        if (action === 'prev') stepWallpaper(-1, true);
        else if (action === 'next') stepWallpaper(1, true);
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

  function preloadWallpaper(filename) {
    if (!filename) return;
    var img = new Image();
    img.src = wallpaperUrl(filename);
  }

  function preloadAdjacent() {
    if (wallpaperList.length < 2) return;
    var next = (wallpaperIndex + 1) % wallpaperList.length;
    var prev = (wallpaperIndex - 1 + wallpaperList.length) % wallpaperList.length;
    preloadWallpaper(wallpaperList[next]);
    preloadWallpaper(wallpaperList[prev]);
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
      stepWallpaper(1, true);
    }, WALLPAPER_INTERVAL_MS);
  }

  function showWallpaper(filename, animate) {
    ensureWallpaperUi();
    var stage = document.querySelector('.wallpaper-stage');
    if (!stage || !filename) return;

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
      preloadAdjacent();
      return;
    }

    fadeLocked = true;
    nextEl.classList.add('is-visible');
    currentEl.classList.remove('is-visible');
    window.setTimeout(function () {
      if (activeLayer !== nextId) {
        // A newer transition may have started; only clear if still outgoing.
      }
      currentEl.style.backgroundImage = '';
      fadeLocked = false;
    }, WALLPAPER_FADE_MS);

    activeLayer = nextId;
    preloadAdjacent();
  }

  function stepWallpaper(delta, animate) {
    if (!wallpaperList.length) return;
    wallpaperIndex = (wallpaperIndex + delta + wallpaperList.length) % wallpaperList.length;
    persistWallpaperState();
    showWallpaper(wallpaperList[wallpaperIndex], animate);
    if (!wallpaperPaused) scheduleWallpaperCycle();
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
