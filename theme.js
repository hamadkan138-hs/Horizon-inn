// theme.js
(function () {
  const storageKey = 'theme';
  const toggleBtn = document.getElementById('theme-toggle');
  const iconSun = document.getElementById('icon-sun');
  const iconMoon = document.getElementById('icon-moon');

  function getStoredTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch (e) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch (e) {
      // ignore
    }
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);

    const isDark = theme === 'dark';
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');

    if (iconSun && iconMoon) {
      if (isDark) {
        iconMoon.style.display = 'block';
        iconSun.style.display = 'none';
      } else {
        iconMoon.style.display = 'none';
        iconSun.style.display = 'block';
      }
    }
  }

  function init() {
    const stored = getStoredTheme();
    const initialTheme = stored ? stored : (systemPrefersDark() ? 'dark' : 'light');
    applyTheme(initialTheme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    storeTheme(next);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    if (!toggleBtn) return;
    toggleBtn.addEventListener('click', function () {
      toggleTheme();
    });

    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
          // Only respect system change if user hasn't set explicit preference
          if (!getStoredTheme()) {
            applyTheme(e.matches ? 'dark' : 'light');
          }
        });
      } catch (e) {
        // ignore older browsers
      }
    }
  });
})();
