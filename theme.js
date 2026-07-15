(function () {
  var STORAGE_KEY = 'theme';

  function preferredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e2) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute(
        'aria-label',
        theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
      );
    }
  }

  function enableTransitions() {
    document.documentElement.classList.add('theme-transitions');
  }

  function toggleTheme() {
    enableTransitions();
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {}
    applyTheme(next);
  }

  // Head bootstrap defines these early; refresh them here. Button uses onclick only
  // (no second click listener) so the toggle does not fire twice.
  window.__applyTheme = applyTheme;
  window.__toggleTheme = toggleTheme;
  applyTheme(preferredTheme());

  // Allow smooth swaps after first paint (never animate the initial theme apply).
  window.addEventListener('load', function () {
    window.requestAnimationFrame(enableTransitions);
  });
})();
