import { requireAdminSession, supabase } from './supabase.js';
import { ensureActiveFut } from './api/futs.js';
import { bootApp, exposeGlobals } from './app.js';

exposeGlobals();

function showLogin(show, err) {
  const el = document.getElementById('login-screen');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
  const errEl = document.getElementById('login-error');
  if (errEl) {
    if (err) { errEl.style.display = ''; errEl.textContent = err; }
    else { errEl.style.display = 'none'; }
  }
}

async function bootWithFut(session) {
  await ensureActiveFut(session);
  await bootApp();
}

async function start() {
  const isAvaliar = location.hash.startsWith('#a=');
  if (isAvaliar) {
    // Síncrono: esconde chrome antes do await do fetch da partida
    document.documentElement.classList.add('modo-avaliar');
    document.body.classList.add('modo-avaliar');
    showLogin(false);
    exposeGlobals();
    await bootApp({ skipAuth: true });
    return;
  }
  let session = await requireAdminSession();
  if (!session) {
    showLogin(true);
    document.getElementById('login-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('login-email')?.value?.trim();
      const password = document.getElementById('login-password')?.value || '';
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { showLogin(true, error.message); return; }
      session = await requireAdminSession();
      if (!session) { showLogin(true, 'Usuário sem role admin (app_metadata.role)'); return; }
      showLogin(false);
      try {
        await bootWithFut(session);
      } catch (e) {
        console.error(e);
        showLogin(true, 'Falha ao carregar dados: ' + (e.message || e));
      }
    });
    return;
  }
  showLogin(false);
  try {
    await bootWithFut(session);
  } catch (e) {
    console.error(e);
    alert('Falha ao iniciar v2: ' + (e.message || e));
  }
}

start().catch(e => {
  console.error(e);
  alert('Falha ao iniciar v2: ' + (e.message || e));
});
