"""Read-only production smoke test for https://miso-abuja.pages.dev.

Checks the guests' menu and the staff console render with no JavaScript
errors or layout overflow, logs in, reads menu/alerts status, and signs out.
It never creates, edits, hides or orders anything.
"""
import base64
import json
import os
import re
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = os.environ.get("MISO_PROD_BASE", "https://miso-abuja.pages.dev")
PORT = 9356
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")


def load_passcode():
    if os.environ.get("MISO_TEST_PASSCODE"):
        return os.environ["MISO_TEST_PASSCODE"]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "staff-passcode.txt")
    try:
        with open(path, encoding="utf-8") as fh:
            match = re.search(r"MISO-[A-Z0-9-]+", fh.read())
            return match.group(0) if match else ""
    except OSError:
        return ""


PASSCODE = load_passcode()
os.makedirs(OUT, exist_ok=True)


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

    def wait_for(self, expression, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.js(expression):
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = {"base": BASE}

    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--force-prefers-reduced-motion",
            "--window-size=500,900",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
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
        cdp.send(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": "window.__errs=[];"
                "window.addEventListener('error',function(e){window.__errs.push(String(e.message))});"
                "window.addEventListener('unhandledrejection',function(e){window.__errs.push('rejection:'+String(e.reason))});"
            },
        )

        # Guest storefront
        cdp.send("Page.navigate", {"url": BASE + "/"})
        out["guestLoaded"] = cdp.wait_for("document.readyState === 'complete' && document.title.length > 0", 40)
        out["guestTitle"] = cdp.js("document.title")
        out["guestMenuStatus"] = cdp.js(
            "(document.getElementById('menuStatus') || {}).textContent || ''"
        )
        out["guestCategories"] = cdp.js("document.querySelectorAll('.menu-category').length")
        out["guestHasBank"] = cdp.js(
            "document.body.innerText.indexOf('5945221845') !== -1"
        )
        out["guestWhatsApp"] = cdp.js(
            "document.body.innerHTML.indexOf('2347025236666') !== -1"
        )
        out["guestOverflow"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        out["guestErrors"] = cdp.js("JSON.stringify(window.__errs || [])")
        cdp.shot(os.path.join(OUT, "prod-guest-390.png"))

        # Staff console
        cdp.send("Page.navigate", {"url": BASE + "/staff/"})
        out["staffLoaded"] = cdp.wait_for(
            "document.readyState === 'complete' && Boolean(document.getElementById('loginButton'))",
            40,
        )
        time.sleep(1.5)
        out["staffLoginVisible"] = cdp.js(
            "!document.getElementById('loginView').hidden"
        )
        cdp.js(
            "(function(){var i=document.getElementById('passcode');"
            "i.value=" + json.dumps(PASSCODE) + ";"
            "document.getElementById('loginButton').click();"
            "return true;})()"
        )
        out["staffLoggedIn"] = cdp.wait_for(
            "!document.getElementById('appView').hidden", 30
        )
        out["staffLoginError"] = cdp.js(
            "document.getElementById('loginError').hidden ? '' : document.getElementById('loginError').textContent"
        )
        out["staffTabs"] = cdp.js(
            "Array.prototype.map.call(document.querySelectorAll('.tab'),function(b){return b.getAttribute('data-tab')}).join(',')"
        )
        out["ordersTitle"] = cdp.js("document.title")

        cdp.js("document.querySelector('.tab[data-tab=menu]').click()")
        out["menuTab"] = cdp.wait_for(
            "!document.getElementById('viewMenu').hidden && document.querySelectorAll('.dish-row').length > 0",
            30,
        )
        out["menuDishes"] = cdp.js("document.querySelectorAll('.dish-row').length")
        out["menuTotal"] = cdp.js(
            "(document.getElementById('menuTotal') || {}).textContent || ''"
        )
        out["menuOverflow"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        cdp.shot(os.path.join(OUT, "prod-staff-menu-390.png"))

        cdp.js("document.querySelector('.tab[data-tab=alerts]').click()")
        out["alertsTab"] = cdp.wait_for(
            "!document.getElementById('viewAlerts').hidden && "
            "document.getElementById('alertDeviceStatus').textContent.indexOf('Checking') === -1",
            30,
        )
        out["alertStatus"] = cdp.js(
            "document.getElementById('alertDeviceStatus').textContent"
        )
        out["alertDevices"] = cdp.js(
            "document.getElementById('alertDeviceCount').textContent"
        )
        out["alertConfigured"] = cdp.js(
            "fetch('/api/alerts/config',{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){return j.configured})"
        )
        out["alertsOverflow"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        cdp.shot(os.path.join(OUT, "prod-staff-alerts-390.png"))

        out["staffErrors"] = cdp.js("JSON.stringify(window.__errs || [])")

        cdp.js("document.getElementById('logoutButton').click()")
        out["staffLoggedOut"] = cdp.wait_for(
            "!document.getElementById('loginView').hidden", 20
        )

        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


if __name__ == "__main__":
    main()
