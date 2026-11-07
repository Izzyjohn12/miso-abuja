/* MISO service worker — keeps the menu shell available offline and refreshes
   it in the background. Bump VERSION to retire old caches after a redesign. */

var VERSION = "miso-v1";
var SHELL_CACHE = "miso-shell-" + VERSION;
var MEDIA_CACHE = "miso-media-" + VERSION;

var SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/css/styles.css",
  "/assets/js/config.js",
  "/assets/js/menu.js",
  "/assets/js/app.js",
  "/assets/img/logo.svg",
  "/assets/img/app/icon-192.png",
  "/assets/img/app/icon-512.png",
  "/assets/img/app/apple-touch-icon.png"
];

var OFFLINE_HTML =
  '<!doctype html><html lang="en-NG"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="theme-color" content="#0b0a09"><title>MISO — offline</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a09;color:#f4efe6;font-family:Karla,system-ui,sans-serif;text-align:center;padding:32px">' +
  '<div><p style="letter-spacing:.42em;color:#c8a267;font-size:12px;margin:0 0 18px">MISO</p>' +
  '<h1 style="font-weight:500;font-size:24px;margin:0 0 10px">You are offline</h1>' +
  '<p style="color:#9d958a;line-height:1.6;margin:0">Reconnect, then reopen the app to see the menu.</p></div></body></html>';

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // Add files one by one so a single hiccup does not abort the install.
      return Promise.all(
        SHELL_FILES.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key.indexOf("miso-") === 0 && key !== SHELL_CACHE && key !== MEDIA_CACHE) {
            return caches.delete(key);
          }
          return null;
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // Google Fonts and other third parties stay on the browser's own networking.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (/\.(?:css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (/\.(?:png|jpe?g|webp|svg|gif|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

/* Pages: always try the network so menu and price changes land immediately;
   fall back to the cached shell when the connection drops. */
function handleNavigation(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) cache.put("/index.html", response.clone());
      return response;
    }).catch(function () {
      return cache.match("/index.html").then(function (hit) {
        if (hit) return hit;
        return cache.match("/").then(function (root) {
          return root || new Response(OFFLINE_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        });
      });
    });
  });
}

/* Styles, scripts and the manifest: network first, cache as the safety net. */
function networkFirst(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(function () {
      return cache.match(request).then(function (hit) {
        return hit || new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      });
    });
  });
}

/* Photography and icons: serve instantly, refresh quietly in the background. */
function staleWhileRevalidate(event, request) {
  return caches.open(MEDIA_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var update = fetch(request).then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function () {
        return null;
      });

      if (hit) {
        event.waitUntil(update);
        return hit;
      }
      return update.then(function (response) {
        return response || new Response("", { status: 504, statusText: "Offline" });
      });
    });
  });
}
