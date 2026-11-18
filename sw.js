// Planner de treino: guarda o app no aparelho para abrir rápido e funcionar sem internet.
// A página vem sempre da internet quando possível, então atualizar o index.html no GitHub basta.
// Só troque a versão abaixo se mudar a forma de guardar (ela apaga as cópias antigas).
const CACHE = 'planner-treino-v1';
const PAGINA = './index.html';

// Guarda uma cópia da resposta (só respostas boas) e devolve a original
function guardar(chave, resp) {
  if (resp.ok) {
    const copia = resp.clone();
    caches.open(CACHE).then(c => c.put(chave, copia));
  }
  return resp;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(PAGINA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    // Começa a baixar a página enquanto o service worker ainda está ligando (abre mais rápido)
    self.registration.navigationPreload?.enable(),
    caches.keys().then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n)))),
  ]).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Abrir o app: tenta a internet primeiro (chega a versão nova); sem internet, abre a cópia guardada.
  // Só guarda páginas HTML que deram certo (nunca um erro 404 ou outro arquivo aberto como página).
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const resp = (await e.preloadResponse) || await fetch(req);
        return resp.headers.get('content-type')?.includes('text/html') ? guardar(PAGINA, resp) : resp;
      } catch {
        return (await caches.match(PAGINA)) || Response.error();
      }
    })());
    return;
  }

  // Arquivos das fontes do Google nunca mudam no mesmo endereço: baixa uma vez e reutiliza
  if (new URL(req.url).origin === 'https://fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(guardado => guardado || fetch(req).then(resp => guardar(req, resp))));
    return;
  }

  // Ícones, manifesto e o CSS das fontes: usa a cópia guardada e atualiza em segundo plano
  e.respondWith(caches.match(req).then(guardado => {
    const daRede = fetch(req).then(resp => guardar(req, resp)).catch(() => guardado || Response.error());
    return guardado || daRede;
  }));
});
