"""Verify the service worker caches the guest shell only — never /api or /staff."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "http://127.0.0.1:8788"
PORT = 9355


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
        res = self.send(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        result = res.get("result", {})
        if result.get("subtype") == "error":
            raise RuntimeError(result.get("description", "JS error"))
        return result.get("value")

    def wait_for(self, expression, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.js(expression):
                    return True
            except Exception:
                pass
            time.sleep(0.25)
        return False


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--window-size=500,900",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    out = {}
    try:
        for _ in range(60):
            try:
                requests.get(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)

        tab = [t for t in requests.get(f"http://127.0.0.1:{PORT}/json").json() if t.get("type") == "page"][0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")

        cdp.send("Page.navigate", {"url": BASE + "/?sw=1"})
        time.sleep(4)
        out["registered"] = cdp.js(
            "navigator.serviceWorker.getRegistration().then(r => Boolean(r))"
        )
        out["ready"] = cdp.js(
            "navigator.serviceWorker.ready.then(r => Boolean(r.active))"
        )

        # Reload so the activated worker controls the page.
        cdp.send("Page.navigate", {"url": BASE + "/?sw=2"})
        time.sleep(4)
        out["controlled"] = cdp.js(
            "navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null"
        )
        out["cacheNames"] = json.loads(cdp.js("caches.keys().then(k => JSON.stringify(k))"))
        out["cachedPaths"] = json.loads(cdp.js("""caches.keys().then(async (names) => {
          const paths = [];
          for (const name of names) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
          }
          return JSON.stringify(paths);
        })"""))

        out["apiCached"] = cdp.js("caches.match('/api/menu').then(hit => Boolean(hit))")
        out["staffCached"] = cdp.js("caches.match('/staff/').then(hit => Boolean(hit))")

        out["apiFetch"] = json.loads(cdp.js("""fetch('/api/menu', {cache: 'no-store'})
          .then(async (r) => JSON.stringify({status: r.status, type: r.headers.get('content-type'),
            length: (await r.text()).length}))"""))
        out["apiCachedAfterFetch"] = cdp.js("caches.match('/api/menu').then(hit => Boolean(hit))")

        out["staffFetch"] = json.loads(cdp.js("""fetch('/staff/', {cache: 'no-store'})
          .then(async (r) => JSON.stringify({status: r.status,
            ok: (await r.text()).includes('Staff console')}))"""))
        out["staffCachedAfterFetch"] = cdp.js("caches.match('/staff/').then(hit => Boolean(hit))")

        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
