// Keeps the game's big files (car models, textures, the built code and the
// fonts) in the browser, so a second visit starts without downloading them
// again. Each file is served from the cache when it is there and fetched
// again in the background, so an update shows up on the visit after. The
// page itself and the /api calls always go to the network.

const CACHE = 'skidline-files-v1'
const KEEP = /^\/(models|textures|assets|screens)\/|\.(woff2?|svg|jpg|webp)$/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('skidline-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || !KEEP.test(url.pathname)) return
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request)
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => hit)
      if (hit) {
        event.waitUntil(fresh)
        return hit
      }
      return fresh
    }),
  )
})
