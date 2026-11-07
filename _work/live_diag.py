"""Diagnose ambient background and horizontal overflow on the live page."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "https://miso-abuja.pages.dev/?v=8"
PORT = 9355
OUT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa"


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
        res = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        return res["result"].get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


proc = subprocess.Popen(
    [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
     "--disable-gpu", "--no-first-run", "--force-prefers-reduced-motion",
     "--window-size=500,900", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    sys.stdout.reconfigure(encoding="utf-8")
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
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(7)
    out = json.loads(cdp.js("""JSON.stringify((() => {
      const de = document.documentElement;
      const amb = document.querySelector('.ambient');
      const cs = amb ? getComputedStyle(amb) : null;
      const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
      const wide = [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.right > de.clientWidth + 2 && r.width > 0;
      }).slice(0, 12).map(el => ({tag: el.tagName, cls: String(el.className).slice(0,50),
        right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width),
        pos: getComputedStyle(el).position}));
      return {
        viewportMeta: (document.querySelector('meta[name=viewport]')||{}).content || null,
        clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        cssLoaded: links,
        sheetCount: document.styleSheets.length,
        ambient: cs ? {bg: cs.backgroundImage.slice(0, 200), pos: cs.position, z: cs.zIndex} : null,
        wide
      };
    })())"""))
    cdp.shot(f"{OUT}\\live-390-home-diag.png")
    print(json.dumps(out, indent=2, ensure_ascii=False))
finally:
    proc.terminate()
    proc.wait(timeout=20)
