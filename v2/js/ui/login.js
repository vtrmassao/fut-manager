/** UI de login — helpers usados por main.js / ajustes. */
export function setLoginVisible(show, errMsg) {
  const el = document.getElementById('login-screen');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
  const errEl = document.getElementById('login-error');
  if (!errEl) return;
  if (errMsg) {
    errEl.style.display = '';
    errEl.textContent = errMsg;
  } else {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
}
