(() => {
  let saved = null;
  try { saved = window.localStorage.getItem('lsar-theme'); } catch {}
  // Dark unless the visitor chose light.
  const dark = saved !== 'light';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
