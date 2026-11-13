// The only script in the design: pick light or dark. ?theme=dark in the URL
// wins (the screenshots use it), then the choice made on index.html, then
// the system setting (no attribute at all).
(() => {
  const root = document.documentElement;
  let saved = null;
  try {
    saved = localStorage.getItem('hallway-theme');
  } catch {}
  const chosen = new URLSearchParams(location.search).get('theme') || saved;
  if (chosen === 'light' || chosen === 'dark') root.dataset.theme = chosen;

  addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('theme');
    if (!toggle) return;
    const dark = () =>
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const label = () => (toggle.textContent = dark() ? 'Light' : 'Dark');
    label();
    toggle.addEventListener('click', () => {
      root.dataset.theme = dark() ? 'light' : 'dark';
      try {
        localStorage.setItem('hallway-theme', root.dataset.theme);
      } catch {}
      label();
    });
  });
})();
