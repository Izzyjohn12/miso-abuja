"""End-to-end flow checks at mobile width: tabs, footer clearance, WhatsApp payloads."""
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8765/index.html"


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
        return res["result"].get("value")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    proc = subprocess.Popen(
        [
            CHROME, "--headless=new", "--remote-debugging-port=9341",
            "--remote-allow-origins=*", "--disable-gpu", "--no-first-run",
            "--window-size=500,900", "about:blank",
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                requests.get("http://127.0.0.1:9341/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        tab = [t for t in requests.get("http://127.0.0.1:9341/json").json() if t.get("type") == "page"][0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(4)
        cdp.js("""localStorage.setItem('miso-cart-v1', JSON.stringify([
            {id:'volcano-roll',qty:2,note:'no wasabi'},
            {id:'salmon-teriyaki',qty:1,note:''},
            {id:'thai-prawn-curry',qty:1,note:'extra rice'}]))""")
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(4)
        print("CART SEED:", cdp.js("JSON.stringify({count: document.getElementById('cartCount').textContent, lines: document.querySelectorAll('#cartLines li').length})"))

        # 1. category tab scroll offset vs sticky stack
        tab_check = cdp.js("""(async () => {
          const btn = [...document.querySelectorAll('.menu-tab')].find(b => /THAI/i.test(b.textContent));
          btn.click();
          await new Promise(r => setTimeout(r, 1200));
          const sec = document.getElementById('menu-thai').getBoundingClientRect();
          const head = document.getElementById('siteHeader').getBoundingClientRect();
          const bar = document.getElementById('menuToolbar').getBoundingClientRect();
          const media = document.querySelector('#menu-thai .category-media').getBoundingClientRect();
          return JSON.stringify({ sectionTop: Math.round(sec.top), headerBottom: Math.round(head.bottom),
            toolbarBottom: Math.round(bar.bottom), mediaTop: Math.round(media.top),
            mediaVisible: Math.round(media.top) >= Math.round(bar.bottom) - 1 });
        })()""")

        # 2. footer clearance with the order bar showing
        foot = cdp.js("""(async () => {
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(r => setTimeout(r, 900));
          const inner = document.querySelector('.footer__bottom');
          const r = inner.getBoundingClientRect();
          const bar = document.getElementById('orderBar').getBoundingClientRect();
          return JSON.stringify({ footerTextBottom: Math.round(r.bottom), barTop: Math.round(bar.top),
            clear: Math.round(r.bottom) <= Math.round(bar.top) });
        })()""")

        # 3. full checkout and both WhatsApp payloads
        flow = cdp.js("""(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const out = {};
          document.getElementById('cartTrigger').click(); await sleep(500);
          document.getElementById('checkoutStart').click(); await sleep(700);
          const g = sel => { const e = document.querySelector(sel); const r = e.getBoundingClientRect();
            const c = getComputedStyle(e);
            return [sel, Math.round(r.height), Math.round(r.top), e.scrollHeight, e.clientHeight, c.overflowY]; };
          out.layout1 = [g('.checkout__frame'), g('.checkout__body'), g('.checkout__main'), g('.checkout__summary')];
          const set = (id, v) => { const el = document.getElementById(id); el.value = v;
            el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('blur', {bubbles:true})); };
          const r = document.querySelector('input[name=service][value="maitama"]');
          r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true}));
          set('customerName','Ada Okonkwo'); set('customerPhone','08031234567');
          set('maitamaAddress','12 Usuma Close, Maitama'); set('maitamaLandmark','Gate 3');
          document.getElementById('detailsForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          await sleep(600);
          out.reference = document.getElementById('bankReference').textContent;
          out.amount = document.getElementById('bankAmount').textContent;
          const c = document.getElementById('transferConfirm');
          c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true}));
          document.getElementById('paymentContinue').click(); await sleep(600);
          const links = [...document.querySelectorAll('#confirmActions a')].map(a => ({
            label: a.textContent.trim().replace(/\\s+/g,' '),
            href: a.href
          }));
          out.links = links.map(l => ({ label: l.label, number: (l.href.match(/wa\\.me\\/(\\d+)/)||[])[1] }));
          const txt = links.map(l => decodeURIComponent((l.href.split('?text=')[1]||'').replace(/\\+/g,' ')));
          out.waiterHasAccount = txt.some(t => /Account number/i.test(t));
          out.chefMentionsPayment = txt.length > 1 ? txt.every(t => /Account number/i.test(t)) : null;
          out.texts = txt;
          out.summaryCount = document.getElementById('summaryCount').textContent;
          out.summaryTotal = document.getElementById('summaryTotal').textContent;
          out.cartCount = document.getElementById('cartCount').textContent;
          out.orderBarHidden = document.getElementById('orderBar').hidden;
          return JSON.stringify(out);
        })()""")

        print("TAB:", tab_check)
        print("FOOTER:", foot)
        print("FLOW:", flow[:4000])
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
