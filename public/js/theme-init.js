/**
 * Apply saved theme before first paint (call from inline script in <head>).
 * Toggle is handled in index.js; this only reads localStorage.
 */
(function applyEclyricsTheme() {
    var stored = localStorage.getItem('eclyrics-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
})();
