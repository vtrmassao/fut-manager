const CACHE = 'futmanager-v2-v11';
const ASSETS = [
  '/fut-manager/v2/',
  '/fut-manager/v2/index.html',
  '/fut-manager/v2/manifest.json',
  '/fut-manager/v2/css/base.css',
  '/fut-manager/v2/css/components.css',
  '/fut-manager/v2/js/main.js',
  '/fut-manager/v2/js/app.js',
  '/fut-manager/v2/js/state.js',
  '/fut-manager/v2/js/supabase.js',
  '/fut-manager/v2/js/api/data.js',
  '/fut-manager/v2/js/api/auth.js',
  '/fut-manager/v2/js/api/functions.js',
  '/fut-manager/v2/js/api/hydrate.js',
  '/fut-manager/v2/js/api/persist.js',
  '/fut-manager/v2/js/api/backup.js',
  '/fut-manager/v2/js/api/futs.js',
  '/fut-manager/v2/js/api/config.js',
  '/fut-manager/v2/js/api/jogadores.js',
  '/fut-manager/v2/js/api/debitos.js',
  '/fut-manager/v2/js/api/partidas.js',
  '/fut-manager/v2/js/api/avaliacoes.js',
  '/fut-manager/v2/js/domain/financeiro.js',
  '/fut-manager/v2/js/domain/ranking.js',
  '/fut-manager/v2/js/ui/login.js',
  '/fut-manager/v2/js/ui/save-badge.js',
  '/fut-manager/v2/js/utils/dates.js',
  '/fut-manager/v2/js/utils/ids.js',
  '/fut-manager/v2/js/utils/money.js',
  '/fut-manager/v2/js/utils/nivel.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/fut-manager/v2/')))
  );
});
