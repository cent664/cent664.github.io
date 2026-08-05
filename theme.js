(function () {
  var STORAGE_KEY = 'theme';
  var WALLPAPER_INTERVAL_MS = 12000;
  var EMAIL_COPY_TEXT = 'adg002 at gmail dot com';
  var DEFAULT_WALLPAPERS = [
    'PXL_20260719_023300571.jpg',
    'PXL_20260719_023859037.jpg',
    'PXL_20260719_032554055.jpg',
    'PXL_20260731_222044010.jpg'
  ];
  var wallpaperTimer = null;
  var wallpaperList = DEFAULT_WALLPAPERS.slice();
  var wallpaperIndex = 0;
  var wallpaperManifestLoaded = false;
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

  function stopWallpaperCycle() {
    if (wallpaperTimer) {
      clearInterval(wallpaperTimer);
      wallpaperTimer = null;
    }
  }

  function applyWallpaperImage(filename) {
    var url = assetBase() + 'wallpapers/' + encodeURIComponent(filename);
    document.documentElement.style.setProperty('--wallpaper-image', 'url("' + url + '")');
  }

  function showNextWallpaper() {
    if (!wallpaperList.length) return;
    wallpaperIndex = (wallpaperIndex + 1) % wallpaperList.length;
    applyWallpaperImage(wallpaperList[wallpaperIndex]);
  }

  function startWallpaperCycle() {
    stopWallpaperCycle();
    if (!wallpaperList.length) {
      document.documentElement.style.removeProperty('--wallpaper-image');
      return;
    }
    wallpaperIndex = Math.floor(Math.random() * wallpaperList.length);
    applyWallpaperImage(wallpaperList[wallpaperIndex]);
    if (wallpaperList.length > 1) {
      wallpaperTimer = setInterval(showNextWallpaper, WALLPAPER_INTERVAL_MS);
    }
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
      stopWallpaperCycle();
      document.documentElement.style.removeProperty('--wallpaper-image');
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
    initNav();
    initEmailCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootUi);
  } else {
    bootUi();
  }
})();
