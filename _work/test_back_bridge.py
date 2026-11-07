"""Exercise the Expo back-button bridge against the live site's overlays."""
import base64
import json
import re
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "https://miso-abuja.pages.dev/?v=app4"
PORT = 9357
ROOT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0"
OUT = ROOT + r"\_work\qa"


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


def bridge_script():
    source = open(ROOT + r"\mobile\src\lib\backBridge.ts", encoding="utf-8").read()
    match = re.search(r"export const CLOSE_OVERLAY_SCRIPT = `(.*?)`;", source, re.S)
    if not match:
        raise RuntimeError("CLOSE_OVERLAY_SCRIPT not found")
    return match.group(1)


def run_script(cdp, script):
    expression = """
      (function () {
        window.__backMessage = null;
        window.ReactNativeWebView = { postMessage: function (m) { window.__backMessage = m; } };
        %s
        return window.__backMessage;
      })()
    """ % script
    raw = cdp.js(expression)
    return json.loads(raw) if raw else None


def state(cdp):
    return json.loads(cdp.js("""JSON.stringify({
      cart: !document.getElementById('cartDrawer').hidden,
      checkout: !document.getElementById('checkout').hidden,
      feedback: !document.getElementById('feedback').hidden,
      nav: document.getElementById('siteNav').classList.contains('is-open')
    })"""))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
         "--disable-gpu", "--no-first-run", "--force-prefers-reduced-motion",
         "--window-size=500,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    results = []
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
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(5)
        cdp.js("""localStorage.setItem('miso-cart-v1', JSON.stringify([
            {id:'volcano-roll',qty:2,note:'no wasabi'},
            {id:'salmon-teriyaki',qty:1,note:''}]))""")
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(5)

        script = bridge_script()

        # 1. nothing open
        results.append({"case": "nothing open", "message": run_script(cdp, script), "state": state(cdp)})

        # 2. cart
        cdp.js("document.getElementById('cartTrigger').click()")
        time.sleep(0.7)
        before = state(cdp)
        message = run_script(cdp, script)
        time.sleep(0.6)
        results.append({"case": "cart open", "before": before,
                        "message": message, "after": state(cdp)})

        # 3. checkout
        cdp.js("document.getElementById('checkoutStart').click()")
        time.sleep(1)
        before = state(cdp)
        message = run_script(cdp, script)
        time.sleep(0.6)
        results.append({"case": "checkout open", "before": before,
                        "message": message, "after": state(cdp)})

        # 4. feedback
        cdp.js("document.querySelector('[data-feedback]').click()")
        time.sleep(0.8)
        before = state(cdp)
        message = run_script(cdp, script)
        time.sleep(0.6)
        results.append({"case": "feedback open", "before": before,
                        "message": message, "after": state(cdp)})

        # 5. mobile nav
        cdp.js("window.scrollTo(0,0); document.getElementById('navToggle').click()")
        time.sleep(0.7)
        before = state(cdp)
        message = run_script(cdp, script)
        time.sleep(0.4)
        results.append({"case": "nav open", "before": before,
                        "message": message, "after": state(cdp)})

        print(json.dumps(results, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
