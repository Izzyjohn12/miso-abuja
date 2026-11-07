"""Capture clipped section screenshots of the MISO site via Chrome DevTools Protocol."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8765/index.html"
PORT = 9333
OUT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa"

TARGETS = [
    ("hero", "#top"),
    ("signatures", "#signatures"),
    ("story", "#story"),
    ("menu-head", "#menu"),
    ("menu-japanese", "#menu-japanese"),
    ("menu-thai", "#menu-thai"),
    ("menu-grill", "#menu-grill"),
    ("gallery", "#gallery"),
    ("visit", "#visit"),
    ("footer", "footer"),
]


class CDP:
    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, max_size=None)
        self.id = 0

    def send(self, method, params=None):
        self.id += 1
        msg = {"id": self.id, "method": method, "params": params or {}}
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply.get("result", {})


def run(width, height, mobile):
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--force-prefers-reduced-motion",
            f"--window-size={width},{height}",
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
        else:
            raise RuntimeError("chrome did not start")

        tab = None
        for verb in (requests.put, requests.post):
            try:
                r = verb(f"http://127.0.0.1:{PORT}/json/new?about:blank", timeout=5)
                if r.ok and r.json().get("webSocketDebuggerUrl"):
                    tab = r.json()
                    break
            except Exception:
                pass
        if tab is None:
            tabs = [t for t in requests.get(f"http://127.0.0.1:{PORT}/json").json()
                    if t.get("type") == "page"]
            tab = tabs[0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile},
        )
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(4)
        cdp.send(
            "Runtime.evaluate",
            {
                "expression": """localStorage.setItem('miso-cart-v1', JSON.stringify(
                  [{id:'volcano-roll',qty:2,note:'no wasabi'},{id:'salmon-teriyaki',qty:1,note:''},
                   {id:'thai-prawn-curry',qty:1,note:'extra rice'}]))"""
            },
        )
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(4)

        # Lazy-loaded imagery never triggers outside the viewport, which would
        # show up as blank tiles in clipped captures. Force everything to load.
        cdp.send(
            "Runtime.evaluate",
            {
                "expression": """(() => {
                  document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
                  return document.images.length;
                })()"""
            },
        )
        time.sleep(3)
        loaded = json.loads(
            cdp.send(
                "Runtime.evaluate",
                {
                    "expression": """JSON.stringify([...document.images].map(i => ({
                      src: (i.currentSrc || i.src).split('/').pop(),
                      ok: !!i.naturalWidth
                    })).filter(o => !o.ok))"""
                },
            )["result"]["value"]
        )
        print(f"[{width}px] unloaded images: {loaded}")

        dims = json.loads(
            cdp.send(
                "Runtime.evaluate",
                {
                    "expression": """JSON.stringify({
                      page: document.documentElement.scrollHeight,
                      overflow: document.documentElement.scrollWidth - window.innerWidth,
                      images: [...document.images].filter(i => i.complete && !i.naturalWidth).length
                    })""",
                    "returnByValue": True,
                },
            )["result"]["value"]
        )
        print(f"[{width}px] page={dims['page']} overflow={dims['overflow']}px brokenImages={dims['images']}")

        for name, selector in TARGETS:
            box = json.loads(
                cdp.send(
                    "Runtime.evaluate",
                    {
                        "expression": f"""JSON.stringify((()=>{{
                          const el = document.querySelector({json.dumps(selector)});
                          if (!el) return null;
                          const r = el.getBoundingClientRect();
                          return {{x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height}};
                        }})())""",
                        "returnByValue": True,
                    },
                )["result"]["value"]
            )
            if not box:
                print(f"  ! missing {selector}")
                continue
            # Scroll the section into the real viewport and shoot that — clipped
            # beyond-viewport captures skip painting offscreen images.
            cdp.send(
                "Runtime.evaluate",
                {
                    "expression": f"""(() => {{
                      document.documentElement.style.scrollBehavior = 'auto';
                      window.scrollTo(0, {round(box['y'])});
                    }})()"""
                },
            )
            time.sleep(1.2)
            shot = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
            with open(f"{OUT}\\{width}-{name}.png", "wb") as fh:
                fh.write(base64.b64decode(shot))

        def shot_view(name):
            data = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
            with open(f"{OUT}\\{width}-{name}.png", "wb") as fh:
                fh.write(base64.b64decode(data))

        def js(expression):
            return cdp.send("Runtime.evaluate", {"expression": expression, "returnByValue": True})

        js("document.getElementById('cartTrigger').click()")
        time.sleep(0.8)
        shot_view("cart-drawer")
        js("document.getElementById('checkoutStart').click()")
        time.sleep(0.8)
        shot_view("checkout-1")
        js(
            """(() => {
              const set = (id, v) => { const el = document.getElementById(id); el.value = v;
                el.dispatchEvent(new Event('input', {bubbles:true}));
                el.dispatchEvent(new Event('blur', {bubbles:true})); };
              const r = document.querySelector('input[name=service][value="maitama"]');
              r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true}));
              set('customerName','Ada Okonkwo'); set('customerPhone','08031234567');
              set('maitamaAddress','12 Usuma Close, Maitama');
              set('maitamaLandmark','Gate 3, opposite the pharmacy');
              document.getElementById('detailsForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
            })()"""
        )
        time.sleep(0.9)
        shot_view("checkout-2")
        js(
            """(() => {
              const c = document.getElementById('transferConfirm');
              if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); }
              document.getElementById('paymentContinue').click();
            })()"""
        )
        time.sleep(0.9)
        shot_view("checkout-3")
        cdp.ws.close()
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    for w, h, m in [(1440, 900, False), (834, 1112, False), (390, 844, True)]:
        run(w, h, m)
