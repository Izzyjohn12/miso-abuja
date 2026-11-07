"""Smoke-test the live Cloudflare Pages deployment at mobile width."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "https://miso-abuja.pages.dev/"
PORT = 9351
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
        time.sleep(6)
        out = {"home": json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          url: location.href,
          dishes: Object.keys((window.MISO_MENU||[]).flatMap(c=>c.groups).flatMap(g=>g.items).reduce((a,i)=>{a[i.id]=1;return a;},{})).length,
          brokenImages: [...document.images].filter(i => i.complete && !i.naturalWidth).length,
          failedResources: [...performance.getEntriesByType('resource')]
            .filter(r => r.responseStatus >= 400)
            .map(r => ({name: r.name.split('/').pop(), status: r.responseStatus})),
          preview: window.MISO_CONFIG.bank.preview,
          headers: document.querySelector('meta[name="description"]') ? 'ok' : 'missing'
        })"""))}

        cdp.js("""localStorage.setItem('miso-cart-v1', JSON.stringify([
            {id:'volcano-roll',qty:2,note:'no wasabi'},
            {id:'salmon-teriyaki',qty:1,note:''},
            {id:'thai-prawn-curry',qty:1,note:'extra rice'}]))""")
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(5)
        cdp.js("document.getElementById('cartTrigger').click()")
        time.sleep(0.7)
        cdp.js("document.getElementById('checkoutStart').click()")
        time.sleep(0.9)
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
        time.sleep(1)
        out["checkout"] = json.loads(cdp.js("""JSON.stringify({
          bank: document.getElementById('bankName').textContent,
          accountName: document.getElementById('bankAccountName').textContent,
          accountNumber: document.getElementById('bankAccountNumber').textContent,
          amount: document.getElementById('bankAmount').textContent,
          subtotal: document.getElementById('summarySubtotal').textContent,
          taxLabel: document.getElementById('summaryTaxLabel').textContent,
          tax: document.getElementById('summaryTax').textContent,
          delivery: document.getElementById('summaryDeliveryLabel').textContent + ' = ' + document.getElementById('summaryDelivery').textContent,
          dueLabel: document.getElementById('summaryTotalLabel').textContent,
          previewBadgeVisible: !document.getElementById('bankPreviewBadge').hidden
        })"""))
        cdp.shot(f"{OUT}\\live-390-checkout-2.png")
        cdp.js("""(() => {
          const c = document.getElementById('transferConfirm');
          c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true}));
          document.getElementById('paymentContinue').click();
        })()""")
        time.sleep(0.9)
        out["handoff"] = json.loads(cdp.js("""JSON.stringify({
          links: [...document.querySelectorAll('#confirmActions a')].map(a => a.href.match(/wa\\.me\\/(\\d+)/)[1]),
          label: (document.querySelector('#confirmActions a')||{}).textContent
            ? document.querySelector('#confirmActions a').textContent.replace(/\\s+/g,' ').trim() : null,
          ref: document.getElementById('confirmReference').textContent
        })"""))
        cdp.shot(f"{OUT}\\live-390-checkout-3.png")
        print(json.dumps(out, indent=2, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
