/* MISO service worker — keeps the guest menu and the staff console available
   offline and refreshes them in the background. Bump VERSION to retire old
   caches after a redesign. */

var VERSION = "miso-v3";
var SHELL_CACHE = "miso-shell-" + VERSION;
var MEDIA_CACHE = "miso-media-" + VERSION;
var STAFF_CACHE = "miso-staff-" + VERSION;

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

var STAFF_FILES = [
  "/staff/",
  "/staff/index.html",
  "/staff/manifest.webmanifest",
  "/staff/staff.css",
  "/staff/staff.js",
  "/assets/img/logo.svg",
  "/assets/img/app/icon-192.png",
  "/assets/img/app/icon-512.png",
  "/assets/img/app/maskable-512.png",
  "/assets/img/app/apple-touch-icon.png",
  "/assets/img/app/staff-menu.png",
  "/assets/img/app/staff-alerts.png"
];

var OFFLINE_HTML =
  '<!doctype html><html lang="en-NG"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="theme-color" content="#0b0a09"><title>MISO — offline</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a09;color:#f4efe6;font-family:Karla,system-ui,sans-serif;text-align:center;padding:32px">' +
  '<div><p style="letter-spacing:.42em;color:#c8a267;font-size:12px;margin:0 0 18px">MISO</p>' +
  '<h1 style="font-weight:500;font-size:24px;margin:0 0 10px">You are offline</h1>' +
  '<p style="color:#9d958a;line-height:1.6;margin:0">Reconnect, then reopen the app to see the menu.</p></div></body></html>';

var STAFF_OFFLINE_HTML =
  '<!doctype html><html lang="en-NG"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="theme-color" content="#0b0a09"><title>MISO Staff — offline</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a09;color:#f4efe6;font-family:Karla,system-ui,sans-serif;text-align:center;padding:32px">' +
  '<div><p style="letter-spacing:.42em;color:#c8a267;font-size:12px;margin:0 0 18px">MISO STAFF</p>' +
  '<h1 style="font-weight:500;font-size:24px;margin:0 0 10px">The queue is offline</h1>' +
  '<p style="color:#9d958a;line-height:1.6;margin:0">Reconnect to load new orders. Phone alerts still arrive when the connection returns.</p></div></body></html>';

self.addEventListener("install", function (event) {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(function (cache) {
        return addAllSafely(cache, SHELL_FILES);
      }),
      caches.open(STAFF_CACHE).then(function (cache) {
        return addAllSafely(cache, STAFF_FILES);
      })
    ]).then(function () {
      return self.skipWaiting();
    })
  );
});

/* Add files one by one so a single hiccup does not abort the install. */
function addAllSafely(cache, files) {
  return Promise.all(
    files.map(function (url) {
      return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
    })
  );
}

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key.indexOf("miso-") === 0 &&
              key !== SHELL_CACHE && key !== MEDIA_CACHE && key !== STAFF_CACHE) {
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

  // The live API must never touch any cache.
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) {
    return;
  }

  // The staff console has its own shell cache. Order data still bypasses it.
  if (url.pathname === "/staff" || url.pathname.indexOf("/staff/") === 0) {
    if (request.mode === "navigate") {
      event.respondWith(handleStaffNavigation(request));
      return;
    }
    if (/\.(?:css|js|webmanifest)$/.test(url.pathname)) {
      event.respondWith(networkFirst(cacheNameFor(url.pathname), request));
      return;
    }
    if (/\.(?:png|jpe?g|webp|svg|gif|ico|woff2?)$/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(event, cacheNameFor(url.pathname), request));
      return;
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (/\.(?:css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(SHELL_CACHE, request));
    return;
  }
  if (/\.(?:png|jpe?g|webp|svg|gif|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, MEDIA_CACHE, request));
  }
});

function cacheNameFor(pathname) {
  return pathname === "/staff" || pathname.indexOf("/staff/") === 0
    ? STAFF_CACHE
    : SHELL_CACHE;
}

/* Pages: always try the network so menu and price changes land immediately;
   fall back to the cached shell when the connection drops. */
function handleNavigation(request) {
  var pathname = new URL(request.url).pathname;
  var isShell = pathname === "/" || pathname === "/index.html";
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok && isShell) cache.put("/index.html", response.clone());
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

/* Staff console pages: always try the network so the queue code stays fresh;
   fall back to the cached app shell when the connection drops. */
function handleStaffNavigation(request) {
  return caches.open(STAFF_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) cache.put("/staff/index.html", response.clone());
      return response;
    }).catch(function () {
      return cache.match("/staff/index.html").then(function (hit) {
        return hit || cache.match("/staff/");
      }).then(function (hit) {
        return hit || new Response(STAFF_OFFLINE_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      });
    });
  });
}

/* Styles, scripts and the manifest: network first, cache as the safety net. */
function networkFirst(cacheName, request) {
  return caches.open(cacheName).then(function (cache) {
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

/* ---------------------------------------------------------------- push -- */

/* Staff alerts keep working when the console is closed. The payload is built
   by functions/_lib/push.js; a missing payload still produces a safe notice. */
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  var isOrder = !data.kind || data.kind === "order";
  var options = {
    body: data.body || "Open the staff console to see the order.",
    icon: "/assets/img/app/icon-192.png",
    badge: "/assets/img/app/icon-192.png",
    tag: data.tag || (data.ref ? "miso-" + data.ref : "miso-order"),
    renotify: true,
    requireInteraction: isOrder ? true : Boolean(data.requireInteraction),
    data: {
      url: data.url || "/staff/#orders",
      orderId: data.orderId || null,
      ref: data.ref || null,
      kind: data.kind || "order"
    },
    vibrate: isOrder
      ? [800, 300, 800, 300, 800, 300, 1200]
      : [120, 80, 120]
  };

  if (isOrder) {
    options.actions = [
      { action: "prepare", title: "Start preparing" },
      { action: "open", title: "Open queue" }
    ];
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "New MISO order", options)
  );
});

self.addEventListener("notificationclick", function (event) {
  var data = event.notification.data || {};
  event.notification.close();

  if (event.action === "prepare" && data.orderId) {
    event.waitUntil(prepareFromNotification(data.orderId));
    return;
  }

  event.waitUntil(openStaff(data.url || "/staff/#orders"));
});

/* Move the order to Preparing straight from the notification. The staff
   session cookie travels with this same-origin PATCH; when it has expired
   the app opens on the login screen instead. */
function prepareFromNotification(orderId) {
  return fetch("/api/orders/" + encodeURIComponent(orderId), {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-MISO-CSRF": "1"
    },
    body: JSON.stringify({ status: "preparing" })
  }).then(function (response) {
    if (!response.ok) throw new Error("status_" + response.status);
    return openStaff("/staff/#orders");
  }).catch(function () {
    return openStaff("/staff/#orders");
  });
}

function openStaff(target) {
  var url = new URL(target, self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i += 1) {
      var client = list[i];
      var clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin &&
          (clientUrl.pathname === "/staff" || clientUrl.pathname.indexOf("/staff/") === 0)) {
        return client.focus().then(function () {
          return client.navigate ? client.navigate(url) : null;
        });
      }
    }
    return self.clients.openWindow(url);
  });
}

/* Photography, screenshots and icons: serve instantly, refresh quietly. */
function staleWhileRevalidate(event, cacheName, request) {
  return caches.open(cacheName).then(function (cache) {
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
