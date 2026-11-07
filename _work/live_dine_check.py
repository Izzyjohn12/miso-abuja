"""Verify the deployed dine-in flow, feedback composer and ambient layer on production."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "https://miso-abuja.pages.dev/?v=7"
PORT = 9353
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


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
         "--disable-gpu", "--no-first-run", "--force-prefers-reduced-motion",
         "--window-size=500,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(3)
        cdp.js("""new Promise(res => {
          const started = Date.now();
          (function poll() {
            const el = document.querySelector('.ambient');
            const ready = el && getComputedStyle(el).backgroundImage.includes('room-blur');
            if (ready || Date.now() - started > 15000) return res(ready);
            setTimeout(poll, 200);
          })();
        })""")

        out = {"ambient": json.loads(cdp.js("""JSON.stringify((() => {
          const el = document.querySelector('.ambient');
          if (!el) return {present: false};
          const bg = getComputedStyle(el).backgroundImage;
          return {present: true, hasTexture: bg.includes('room-blur.webp'),
                  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
        })())"""))}

        out["hint"] = cdp.js("document.querySelector('[data-service-panel=\"dine-in\"] .field-hint').textContent.trim()")

        cdp.js("""localStorage.setItem('miso-cart-v1', JSON.stringify([
            {id:'volcano-roll',qty:2,note:'no wasabi'},
            {id:'salmon-teriyaki',qty:1,note:''},
            {id:'thai-prawn-curry',qty:1,note:'extra rice'}]))""")
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(5)

        # feedback dialog before checkout
        out["feedback"] = json.loads(cdp.js("""JSON.stringify((() => {
          const btns = [...document.querySelectorAll('[data-feedback]')];
          if (!btns.length) return {triggers: 0};
          btns[0].click();
          const open = !document.getElementById('feedback').hidden;
          document.getElementById('feedbackMessage').value = 'Lovely room, will be back.';
          const r = document.querySelector('input[name=rating][value="Loved it"]');
          if (r) { r.checked = true; }
          let href = null;
          window.__fbHref = null;
          const orig = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () { window.__fbHref = this.href; };
          document.getElementById('feedbackForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
          HTMLAnchorElement.prototype.click = orig;
          href = window.__fbHref;
          return {triggers: btns.length, open,
                  link: href ? decodeURIComponent(href).slice(0, 160) : null,
                  numberOk: href ? /wa\\.me\\/2347025236666/.test(href) : false};
        })())"""))
        time.sleep(0.6)
        out["feedback"]["closed"] = cdp.js("document.getElementById('feedback').hidden")

        cdp.js("document.getElementById('cartTrigger').click()")
        time.sleep(0.7)
        cdp.js("document.getElementById('checkoutStart').click()")
        time.sleep(1.1)

        out["dineStep1"] = json.loads(cdp.js("""JSON.stringify((() => {
          const r = document.querySelector('input[name=service][value="dine-in"]');
          r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true}));
          const name = document.getElementById('customerName');
          const phone = document.getElementById('customerPhone');
          return {
            title: document.getElementById('checkoutTitle').textContent,
            step1: document.getElementById('step1Name').textContent,
            note: document.getElementById('dineInNote').textContent.trim(),
            contactHidden: name.closest('label').hidden && phone.closest('label').hidden,
            contactDisabled: name.disabled && phone.disabled,
            tableRequired: document.getElementById('tableNumber').required,
            visibleRequired: [...document.querySelectorAll('#detailsForm [required]')]
              .filter(el => el.offsetParent !== null && !el.disabled).map(el => el.id)
          };
        })())"""))
        cdp.js("document.getElementById('detailsForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
        time.sleep(1.1)

        out["dineStep2"] = json.loads(cdp.js("""JSON.stringify((() => {
          const note = document.getElementById('payLaterNote');
          return {
            heading: document.getElementById('paymentHeading').textContent,
            amount: document.getElementById('bankAmount').textContent,
            dueLabel: document.getElementById('summaryTotalLabel').textContent,
            confirmHidden: document.getElementById('transferConfirmRow').hidden,
            continueEnabled: !document.getElementById('paymentContinue').disabled,
            laterNoteVisible: !note.hidden,
            bankRows: [document.getElementById('bankName').textContent,
                       document.getElementById('bankAccountName').textContent,
                       document.getElementById('bankAccountNumber').textContent]
          };
        })())"""))
        cdp.shot(f"{OUT}\\live-390-dine-2.png")
        cdp.js("document.getElementById('paymentContinue').click()")
        time.sleep(1)
        out["dineStep3"] = json.loads(cdp.js("""JSON.stringify({
            heading: document.getElementById('confirmHeading').textContent,
            note: document.getElementById('confirmNote').textContent.trim(),
            links: [...document.querySelectorAll('#confirmActions a')].map(a => a.href.match(/wa\\.me\\/(\\d+)/)[1]),
            ref: document.getElementById('confirmReference').textContent.trim()
        })"""))
        cdp.shot(f"{OUT}\\live-390-dine-3.png")
        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
