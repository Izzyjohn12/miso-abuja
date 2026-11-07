"""Prove the guest page consumes /api/menu, not the static menu.js.

Run against `wrangler pages dev dist` on 127.0.0.1:8788. The local D1 is
expected to contain a temporary rename of ebi-fry to "Ebi Fry Live" (done by
the calling shell); this script also checks the static fallback by blocking
the API request and reloading.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time

import requests
from websocket import create_connection

ROOT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0"
QA = os.path.join(ROOT, "_work", "qa")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9353
URL = "http://127.0.0.1:8788/"


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


def wait_for(cdp, expression, timeout=25, label=""):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cdp.js(expression):
                return True
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError(f"timeout waiting for {label or expression}")


def snapshot(cdp):
    raw = cdp.js("""JSON.stringify({
      dishes: document.querySelectorAll('.menu-item').length,
      categories: document.querySelectorAll('.menu-category').length,
      tabs: document.querySelectorAll('.menu-tab').length,
      signatures: document.querySelectorAll('.sig-card').length,
      status: document.getElementById('menuStatus').textContent,
      liveEbi: !!document.querySelector('.menu-item[data-name="ebi fry live"]'),
      staticEbi: !!document.querySelector('.menu-item[data-name="ebi fry"]'),
      menuCount: Array.isArray(window.MISO_MENU) ? window.MISO_MENU.length : -1,
      sigCount: Array.isArray(window.MISO_SIGNATURES) ? window.MISO_SIGNATURES.length : -1,
      apiEntry: (performance.getEntriesByType('resource')
        .filter(r => r.name.indexOf('/api/menu') !== -1)[0] || {}).name || null,
      apiStatus: (performance.getEntriesByType('resource')
        .filter(r => r.name.indexOf('/api/menu') !== -1)[0] || {}).responseStatus || null,
      errors: window.__errors || [],
      failed: window.__failed || [],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    })""")
    return json.loads(raw)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(QA, exist_ok=True)

    profile = tempfile.mkdtemp(prefix="miso-live-menu-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*", "--disable-gpu", "--no-first-run",
         f"--user-data-dir={profile}", "--window-size=390,844", "about:blank"],
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
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True,
        })
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {
            "source": "window.__errors=[];window.__failed=[];"
                      "addEventListener('error',function(e){"
                      " if(e.target&&(e.target.tagName==='SCRIPT'||e.target.tagName==='LINK'||e.target.tagName==='IMG'))"
                      " {window.__failed.push(e.target.src||e.target.href)}"
                      " else {window.__errors.push(String(e.message))}"
                      "},true);"
                      "addEventListener('unhandledrejection',function(e){window.__errors.push(String(e.reason))});"
        })

        cdp.send("Page.navigate", {"url": URL})
        wait_for(cdp, "document.readyState === 'complete' && "
                      "document.querySelectorAll('.menu-item').length === 114",
                 30, "live menu")
        time.sleep(1.2)
        out["live"] = snapshot(cdp)
        cdp.shot(os.path.join(QA, "live-menu-390.png"))

        cdp.send("Network.setBlockedURLs", {"urls": ["*api/menu*"]})
        cdp.send("Page.reload", {"ignoreCache": True})
        wait_for(cdp, "document.readyState === 'complete' && "
                      "document.querySelectorAll('.menu-item').length === 114",
                 30, "static fallback")
        time.sleep(0.8)
        out["fallback"] = snapshot(cdp)
        cdp.send("Network.setBlockedURLs", {"urls": []})
    finally:
        proc.terminate()

    print(json.dumps(out, indent=2))

    live = out["live"]
    fallback = out["fallback"]
    assert live["dishes"] == 114 and live["categories"] == 6 and live["tabs"] == 6, live
    assert live["signatures"] == 4 and live["menuCount"] == 6 and live["sigCount"] == 4, live
    assert live["liveEbi"] and not live["staticEbi"], "page did not use live D1 content"
    assert live["apiEntry"] and live["apiStatus"] == 200, "api request missing"
    assert not live["errors"], live["errors"]
    assert live["overflow"] <= 0, live["overflow"]
    assert fallback["dishes"] == 114 and fallback["staticEbi"], "static fallback broken"
    assert not fallback["errors"], fallback["errors"]
    print("PASS live menu + static fallback")


if __name__ == "__main__":
    main()
