"""End-to-end check of the MISO web app: manifest, service worker, offline shell."""
import base64
import functools
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import requests
from websocket import create_connection

ROOT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0"
DIST = os.path.join(ROOT, "dist")
QA = os.path.join(ROOT, "_work", "qa")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9352
HTTP_PORT = 8123
URL = f"http://127.0.0.1:{HTTP_PORT}/"


class CDP:
    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, max_size=None)
        self.id = 0

    def send(self, method, params=None):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params or {}}))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply.get("result", {})

    def js(self, expression):
        res = self.send("Runtime.evaluate", {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        })
        if res["result"].get("subtype") == "error":
            raise RuntimeError(res["result"].get("description"))
        return res["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


def wait_for(cdp, expression, timeout=20, label=""):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cdp.js(expression):
                return True
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError(f"timeout waiting for {label or expression}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(QA, exist_ok=True)

    handler = functools.partial(SimpleHTTPRequestHandler, directory=DIST)
    handler.log_message = lambda *a, **k: None
    server = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    profile = tempfile.mkdtemp(prefix="miso-pwa-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*", "--disable-gpu", "--no-first-run",
         f"--user-data-dir={profile}", "--window-size=500,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    out = {}
    try:
        for _ in range(60):
            try:
                requests.get(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        tab = [t for t in requests.get(f"http://127.0.0.1:{PORT}/json").json()
               if t.get("type") == "page"][0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send("Log.enable")
        cdp.send("Network.enable")

        cdp.send("Page.addScriptToEvaluateOnNewDocument", {
            "source": "window.__errors=[];"
                      "addEventListener('error',e=>window.__errors.push(String(e.message)));"
                      "addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));"
        })

        cdp.send("Page.navigate", {"url": URL})
        wait_for(cdp, "document.readyState === 'complete' && document.querySelectorAll('.menu-item').length > 100",
                 30, "first load")
        time.sleep(1.5)

        out["firstLoad"] = json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          dishes: document.querySelectorAll('.menu-item').length,
          manifestHref: document.querySelector('link[rel=manifest]') ? document.querySelector('link[rel=manifest]').href : null,
          appleIcon: document.querySelector('link[rel=apple-touch-icon]') ? document.querySelector('link[rel=apple-touch-icon]').getAttribute('href') : null,
          themeColor: document.querySelector('meta[name=theme-color]').content,
          installButton: !!document.getElementById('installApp'),
          installHidden: document.getElementById('installApp').hidden,
          standalone: matchMedia('(display-mode: standalone)').matches,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        })"""))

        cdp.send("Page.reload")
        wait_for(cdp, "document.readyState === 'complete' && !!navigator.serviceWorker.controller",
                 20, "service worker control")
        time.sleep(1.2)

        out["manifest"] = json.loads(cdp.js("""fetch('/manifest.webmanifest').then(r => r.json()).then(m => JSON.stringify({
          name: m.name, short_name: m.short_name, display: m.display,
          start_url: m.start_url, scope: m.scope,
          theme: m.theme_color, background: m.background_color,
          icons: m.icons.map(i => i.sizes + ':' + i.purpose),
          shortcuts: m.shortcuts.length
        }))"""))

        out["sw"] = json.loads(cdp.js("""(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          const keys = await caches.keys();
          const counts = {};
          for (const key of keys) counts[key] = (await (await caches.open(key)).keys()).length;
          return JSON.stringify({
            controlled: !!navigator.serviceWorker.controller,
            scope: regs[0] ? regs[0].scope : null,
            caches: counts
          });
        })()"""))

        cdp.shot(os.path.join(QA, "pwa-online.png"))

        # Offline: the navigation and shell should come from the cache.
        cdp.send("Network.emulateNetworkConditions", {
            "offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1,
        })
        cdp.send("Page.reload")
        time.sleep(3.5)
        out["offline"] = json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          dishes: document.querySelectorAll('.menu-item').length,
          styled: getComputedStyle(document.body).backgroundColor,
          headerVisible: !!document.querySelector('#siteHeader'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          errors: window.__errors || []
        })"""))
        cdp.shot(os.path.join(QA, "pwa-offline.png"))

        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1,
        })

        # Reconnect and confirm the network path still works.
        cdp.send("Page.reload")
        wait_for(cdp, "document.readyState === 'complete' && document.querySelectorAll('.menu-item').length > 100",
                 20, "online reload")

        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
