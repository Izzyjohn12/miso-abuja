"""Visual check of the install entry point in the live footer."""
import base64
import json
import shutil
import subprocess
import tempfile
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9354
URL = "https://miso-abuja.pages.dev/?pwa=footer"


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
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"])[:500])
        return res["result"].get("value")


def main():
    profile = tempfile.mkdtemp(prefix="miso-footer-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*", "--disable-gpu", "--no-first-run",
         f"--user-data-dir={profile}", "--window-size=390,844", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
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
        cdp.send("Page.navigate", {"url": URL})
        for _ in range(80):
            if cdp.js("document.readyState === 'complete' && document.querySelectorAll('.menu-item').length > 100"):
                break
            time.sleep(0.5)
        time.sleep(2.5)

        cdp.js("document.getElementById('installApp').scrollIntoView({block: 'center'})")
        time.sleep(0.4)
        out = {
            "hidden": cdp.js("document.getElementById('installApp').hidden"),
            "display": cdp.js("getComputedStyle(document.getElementById('installApp')).display"),
            "text": cdp.js("document.getElementById('installApp').textContent.trim()"),
            "navItems": cdp.js("document.getElementById('installApp').parentElement.children.length"),
            "footerOverflow": cdp.js("document.documentElement.scrollWidth - document.documentElement.clientWidth"),
            "standalone": cdp.js("matchMedia('(display-mode: standalone)').matches"),
        }
        time.sleep(0.8)
        time.sleep(0.8)
        data = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa\pwa-footer.png", "wb") as fh:
            fh.write(base64.b64decode(data))
        print(json.dumps(out, indent=2))
    finally:
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)


main()
