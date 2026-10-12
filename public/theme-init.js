// Apply the saved light/dark choice before anything is drawn (see src/lib/theme.ts).
// A separate file rather than an inline script, so the Content-Security-Policy can stay script-src 'self'.
;(function () {
  var t
  try {
    t = localStorage.getItem('theme')
  } catch (e) {}
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  }
})()
