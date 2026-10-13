(() => {
  let saved = null;
  try { saved = window.localStorage.getItem('lsar-theme'); } catch {}
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = saved === 'dark' || (saved !== 'light' && systemDark);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
