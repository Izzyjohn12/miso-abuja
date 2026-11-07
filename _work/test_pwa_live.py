"""Check the live MISO PWA: installability, service worker, offline reload."""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "https://miso-abuja.pages.dev/?pwa=check"
PORT = 9353
QA = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa"


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
        return res["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


def wait_for(cdp, expression, timeout=25, label=""):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cdp.js(expression):
                return True
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"timeout waiting for {label or expression}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(QA, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="miso-live-pwa-")
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
        cdp.send("Network.enable")
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {
            "source": "window.__errors=[];"
                      "addEventListener('error',e=>window.__errors.push(String(e.message)));"
                      "addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));"
        })

        cdp.send("Page.navigate", {"url": URL})
        wait_for(cdp, "document.readyState === 'complete' && document.querySelectorAll('.menu-item').length > 100",
                 40, "live first load")
        time.sleep(2)

        manifest = cdp.send("Page.getAppManifest")
        parsed = manifest.get("parsed") or {}
        out["manifest"] = {
            "url": manifest.get("url"),
            "errors": manifest.get("errors"),
            "name": parsed.get("name"),
            "short_name": parsed.get("short_name"),
            "display": parsed.get("display"),
            "icons": len(parsed.get("icons") or []),
        }
        try:
            out["installability"] = cdp.send("Page.getInstallabilityErrors")
        except Exception as exc:
            out["installability"] = {"error": str(exc)}

        cdp.send("Page.reload")
        wait_for(cdp, "document.readyState === 'complete' && !!navigator.serviceWorker.controller",
                 25, "live service worker")
        time.sleep(1.5)

        out["sw"] = json.loads(cdp.js("""(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          const keys = await caches.keys();
          const counts = {};
          for (const key of keys) counts[key] = (await (await caches.open(key)).keys()).length;
          return JSON.stringify({
            controlled: !!navigator.serviceWorker.controller,
            scope: reg ? reg.scope : null,
            state: reg && reg.active ? reg.active.state : null,
            caches: counts
          });
        })()"""))

        cdp.shot(os.path.join(QA, "pwa-live.png"))

        cdp.send("Network.emulateNetworkConditions", {
            "offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1,
        })
        cdp.send("Page.reload")
        time.sleep(4)
        out["offline"] = json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          dishes: document.querySelectorAll('.menu-item').length,
          hero: !!document.querySelector('.hero'),
          bg: getComputedStyle(document.documentElement).backgroundColor,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          errors: window.__errors || []
        })"""))
        cdp.shot(os.path.join(QA, "pwa-live-offline.png"))

        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
