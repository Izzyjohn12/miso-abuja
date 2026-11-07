"""Phase 2 browser test — guest checkout submits, staff console receives and moves it."""
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
BASE = "http://127.0.0.1:8788"
PORT = 9354
OUT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa"


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

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


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
            "--force-prefers-reduced-motion",
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
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
        })
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__misoErrors = [];
          window.addEventListener('error', function (e) {
            window.__misoErrors.push(String(e.message || e.error));
          });
          window.addEventListener('unhandledrejection', function (e) {
            window.__misoErrors.push('rejection: ' + String(e.reason));
          });
          var origError = console.error;
          console.error = function () {
            window.__misoErrors.push([].slice.call(arguments).join(' '));
            return origError.apply(console, arguments);
          };
        """})

        stamp = str(int(time.time()))
        cdp.send("Page.navigate", {"url": BASE + "/?e2e=" + stamp})
        time.sleep(3)
        cdp.js("localStorage.setItem('miso-cart-v1', JSON.stringify([{id:'ebi-fry',qty:2,note:'no mayo'},{id:'miso-shiro',qty:1,note:''}]))")
        cdp.send("Page.navigate", {"url": BASE + "/?e2e=" + stamp})
        time.sleep(3)

        out["guestLoaded"] = cdp.wait_for("Boolean(document.querySelector('.dish-card'))", 20)
        out["overflowBefore"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )

        cdp.js("document.getElementById('cartTrigger').click()")
        time.sleep(0.8)
        cdp.js("document.getElementById('checkoutStart').click()")
        time.sleep(1.2)

        out["checkoutOpen"] = cdp.js("!document.getElementById('checkout').hidden")

        cdp.js("""(() => {
          const radio = document.querySelector('input[name=service][value="dine-in"]');
          radio.checked = true;
          radio.dispatchEvent(new Event('change', {bubbles: true}));
          const table = document.getElementById('tableNumber');
          table.value = '7';
          table.dispatchEvent(new Event('input', {bubbles: true}));
          document.getElementById('detailsForm').dispatchEvent(
            new Event('submit', {bubbles: true, cancelable: true})
          );
        })()""")
        time.sleep(1.2)

        out["step2"] = json.loads(cdp.js("""JSON.stringify({
          heading: document.getElementById('paymentHeading').textContent,
          amount: document.getElementById('bankAmount').textContent,
          continueEnabled: !document.getElementById('paymentContinue').disabled,
          laterVisible: !document.getElementById('payLaterNote').hidden
        })"""))
        cdp.shot(os.path.join(OUT, "phase2-guest-dine-390.png"))

        cdp.js("document.getElementById('paymentContinue').click()")

        submitted = cdp.wait_for(
            "(() => { const el = document.getElementById('submitStatus');"
            " return el && !el.hidden && el.textContent.indexOf('Kitchen notified') !== -1; })()",
            30,
        )
        out["submittedToKitchen"] = submitted
        out["submitStatus"] = cdp.js("document.getElementById('submitStatus').textContent")
        out["submitClass"] = cdp.js("document.getElementById('submitStatus').className")
        out["reference"] = cdp.js("document.getElementById('confirmReference').textContent.trim()")
        out["handoff"] = cdp.js(
            "[...document.querySelectorAll('#confirmActions a')].map(a => a.href.includes('wa.me/2347025236666')).every(Boolean)"
        )
        out["whatsappLinks"] = cdp.js("document.querySelectorAll('#confirmActions a').length")
        out["overflowConfirm"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        cdp.shot(os.path.join(OUT, "phase2-guest-confirm-390.png"))

        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False,
        })
        time.sleep(1)
        cdp.shot(os.path.join(OUT, "phase2-guest-confirm-desktop.png"))
        out["overflowDesktop"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )

        out["guestErrors"] = cdp.js("JSON.stringify(window.__misoErrors || [])")

        # ---------------------------------------------------------- staff --
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
        })
        cdp.send("Page.navigate", {"url": BASE + "/staff/?e2e=" + stamp})
        time.sleep(2)

        out["loginVisible"] = cdp.wait_for(
            "document.activeElement && document.activeElement.id === 'passcode'", 20
        )
        cdp.js("document.getElementById('passcode').value = " + json.dumps(PASSCODE))
        cdp.js("document.getElementById('loginForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
        out["staffLoggedIn"] = cdp.wait_for(
            "!document.getElementById('appView').hidden && document.querySelectorAll('.order').length > 0",
            20,
        )
        out["staffLoginError"] = cdp.js("document.getElementById('loginError').textContent")

        out["staffCard"] = json.loads(cdp.js("""JSON.stringify((() => {
          const card = document.querySelector('.order');
          if (!card) return null;
          return {
            ref: card.querySelector('.order__ref').textContent,
            status: card.querySelector('.chip').textContent,
            service: card.querySelector('.order__service').textContent,
            detail: card.querySelector('.order__detail') ? card.querySelector('.order__detail').textContent : '',
            items: [...card.querySelectorAll('.order__items li')].map(li => li.textContent.trim()),
            total: card.querySelector('.order__totals .total strong').textContent,
            actions: [...card.querySelectorAll('[data-act]')].map(b => b.textContent.trim())
          };
        })())"""))
        out["staffCounts"] = json.loads(cdp.js("""JSON.stringify({
          new: document.getElementById('newCount').textContent,
          kitchen: document.getElementById('activeCount').textContent,
          today: document.getElementById('todayCount').textContent,
          updated: document.getElementById('updatedAt').textContent
        })"""))
        out["overflowStaff"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        cdp.shot(os.path.join(OUT, "phase2-staff-390.png"))

        cdp.js("""(() => {
          const btn = document.querySelector('.order [data-act="status"][data-status="preparing"]');
          if (btn) btn.click();
        })()""")
        out["movedToKitchen"] = cdp.wait_for(
            "(() => { const chip = document.querySelector('.order .chip');"
            " return chip && chip.textContent.trim() === 'Preparing'; })()",
            20,
        )
        out["staffCountsAfter"] = json.loads(cdp.js("""JSON.stringify({
          new: document.getElementById('newCount').textContent,
          kitchen: document.getElementById('activeCount').textContent
        })"""))
        out["staffToast"] = cdp.js("document.getElementById('toast').textContent")
        cdp.shot(os.path.join(OUT, "phase2-staff-preparing-390.png"))

        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False,
        })
        time.sleep(1)
        cdp.shot(os.path.join(OUT, "phase2-staff-desktop.png"))
        out["overflowStaffDesktop"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        out["staffErrors"] = cdp.js("JSON.stringify(window.__misoErrors || [])")

        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
