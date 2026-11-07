"""Verify the 10% tax, Bolt delivery quoting, bank details and menu price changes."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8765/index.html"
PORT = 9347
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


def launch(width, height, mobile):
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
         "--disable-gpu", "--no-first-run", "--force-prefers-reduced-motion",
         "--window-size=500,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
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
             {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile})
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(4)
    cdp.js("""localStorage.setItem('miso-cart-v1', JSON.stringify([
        {id:'volcano-roll',qty:2,note:'no wasabi'},
        {id:'salmon-teriyaki',qty:1,note:''},
        {id:'thai-prawn-curry',qty:1,note:'extra rice'}]))""")
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(4)
    return proc, cdp


def run():
    sys.stdout.reconfigure(encoding="utf-8")
    proc, cdp = launch(390, 844, True)
    try:
        out = {}
        out["menu"] = json.loads(cdp.js("""JSON.stringify({
          mixMeat: (window.MISO_MENU.flatMap(c=>c.groups).flatMap(g=>g.items).find(i=>i.id==='mix-meat-fried-rice')||{}).price,
          phadThai: (window.MISO_MENU.flatMap(c=>c.groups).flatMap(g=>g.items).find(i=>i.id==='phad-thai-prawns')||{}).price,
          mixMeatRow: (()=>{ const row=[...document.querySelectorAll('.menu-item')].find(r=>/Mix Meat Fried Rice/i.test(r.textContent)); return row ? row.textContent.replace(/\\s+/g,' ').trim() : null; })(),
          phadRow: (()=>{ const row=[...document.querySelectorAll('.menu-item')].find(r=>/Phad Thai Noodles with Prawns/i.test(r.textContent)); return row ? row.textContent.replace(/\\s+/g,' ').trim() : null; })()
        })"""))
        out["bankPreviewHidden"] = cdp.js("document.getElementById('bankPreviewBadge').hidden")
        out["bankWarningHidden"] = cdp.js("document.getElementById('bankWarning').hidden")

        # cart drawer
        cdp.js("document.getElementById('cartTrigger').click()")
        time.sleep(0.8)
        out["cartNote"] = cdp.js("document.getElementById('cartDeliveryNote').textContent")
        out["cartSubtotal"] = cdp.js("document.getElementById('cartSubtotal').textContent")
        cdp.shot(f"{OUT}\\390-cart-tax.png")
        cdp.js("document.getElementById('checkoutStart').click()")
        time.sleep(0.9)

        # step 1 summary (below the form on mobile)
        cdp.js("document.querySelector('.checkout__body').scrollTop = 99999")
        time.sleep(0.8)
        cdp.shot(f"{OUT}\\390-summary-tax.png")
        out["step1"] = json.loads(cdp.js("""JSON.stringify({
          subtotal: document.getElementById('summarySubtotal').textContent,
          taxLabel: document.getElementById('summaryTaxLabel').textContent,
          tax: document.getElementById('summaryTax').textContent,
          totalLabel: document.getElementById('summaryTotalLabel').textContent,
          total: document.getElementById('summaryTotal').textContent,
          deliveryHidden: document.getElementById('summaryDeliveryRow').hidden
        })"""))

        # delivery + payment
        cdp.js("""(() => {
          const set = (id, v) => { const el = document.getElementById(id); el.value = v;
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('blur', {bubbles:true})); };
          const r = document.querySelector('input[name=service][value="maitama"]');
          r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true}));
          set('customerName','Ada Okonkwo'); set('customerPhone','08031234567');
          set('maitamaAddress','12 Usuma Close, Maitama');
          set('maitamaLandmark','Gate 3, opposite the pharmacy');
          document.getElementById('detailsForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
        })()""")
        time.sleep(0.9)
        out["step2"] = json.loads(cdp.js("""JSON.stringify({
          badgeVisible: !document.getElementById('bankPreviewBadge').hidden,
          bank: document.getElementById('bankName').textContent,
          accountName: document.getElementById('bankAccountName').textContent,
          accountNumber: document.getElementById('bankAccountNumber').textContent,
          amount: document.getElementById('bankAmount').textContent,
          payAmount: document.getElementById('payStepAmount').textContent,
          deliveryNoteVisible: !document.getElementById('payDeliveryNote').hidden,
          deliveryNote: document.getElementById('payDeliveryNote').textContent,
          deliveryRow: document.getElementById('summaryDeliveryLabel').textContent + ' = ' + document.getElementById('summaryDelivery').textContent,
          dueLabel: document.getElementById('summaryTotalLabel').textContent
        })"""))
        cdp.shot(f"{OUT}\\390-checkout-2-tax.png")

        # payment note + confirm, bottom of step 2
        cdp.js("""document.querySelector('.checkout__body').scrollTop = 99999;
          document.querySelector('.checkout__main').scrollTop = 99999;""")
        time.sleep(0.8)
        cdp.shot(f"{OUT}\\390-checkout-2-note.png")
        cdp.js("""(() => {
          const c = document.getElementById('transferConfirm');
          if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); }
          document.getElementById('paymentContinue').click();
        })()""")
        time.sleep(0.9)
        out["handoff"] = json.loads(cdp.js("""JSON.stringify({
          links: [...document.querySelectorAll('#confirmActions a')].length,
          label: document.querySelector('#confirmActions a') ? document.querySelector('#confirmActions a').textContent.replace(/\\s+/g,' ').trim() : null
        })"""))
        cdp.shot(f"{OUT}\\390-checkout-3-tax.png")

        # arithmetic cross-check against the seeded cart
        out["math"] = json.loads(cdp.js("""JSON.stringify({
          subtotal: 57200 + 42900 + 28500,
          tax: Math.round((57200 + 42900 + 28500) * 0.1)
        })"""))
        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    run()
