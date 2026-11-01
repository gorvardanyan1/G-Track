/* global document, localStorage, matchMedia */
// Applies the saved theme before first paint (no flash of the wrong theme). A file, not an
// inline script, so the Content-Security-Policy can stay at script-src 'self'.
try {
  const saved = localStorage.getItem('tempo.theme');
  const dark =
    saved === 'dark' || (saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  // Storage blocked (private mode): the system theme applies once the app starts.
}
