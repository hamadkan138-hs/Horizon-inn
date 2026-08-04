// Site-wide dark/light theme switch. Persists choice in localStorage;
// defaults to dark since that's this site's established look everywhere.
(function () {
    const STORAGE_KEY = 'horizonTheme';

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        document.querySelectorAll('.theme-toggle').forEach((el) => {
            el.setAttribute('aria-checked', theme === 'light' ? 'true' : 'false');
        });
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    applyTheme(stored === 'light' ? 'light' : 'dark');

    function wireToggle(el) {
        el.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            localStorage.setItem(STORAGE_KEY, next);
            applyTheme(next);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.theme-toggle').forEach(wireToggle);
        });
    } else {
        document.querySelectorAll('.theme-toggle').forEach(wireToggle);
    }
})();
