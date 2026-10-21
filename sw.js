/* 오프라인 캐시 서비스워커. 앱 셸(정적 파일)을 캐시-우선으로 제공. */
const CACHE = 'transit-tt-v12';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './seed-data.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' — 브라우저 HTTP 캐시를 건너뛰어, 배포 직후에도 옛 파일이 박제되지 않게
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // 앱 셸: 캐시 우선, 없으면 네트워크 후 캐시에 저장
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
