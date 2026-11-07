"""Production-readiness audit for the MISO site via Chrome DevTools Protocol."""
import json
import subprocess
import time

import requests
from websocket import create_connection

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8765/index.html"


class CDP:
    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, max_size=None)
        self.id = 0
        self.events = []

    def send(self, method, params=None):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params or {}}))
        while True:
            reply = json.loads(self.ws.recv())
            if "id" in reply:
                if reply.get("id") == self.id:
                    if "error" in reply:
                        raise RuntimeError(f"{method}: {reply['error']}")
                    return reply.get("result", {})
            else:
                self.events.append(reply)

    def drain(self, ticks=0):
        self.ws.settimeout(0.3)
        for _ in range(ticks):
            try:
                self.events.append(json.loads(self.ws.recv()))
            except Exception:
                break
        self.ws.settimeout(None)


def main():
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            "--remote-debugging-port=9340",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--window-size=1440,900",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                requests.get("http://127.0.0.1:9340/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        tab = [t for t in requests.get("http://127.0.0.1:9340/json").json() if t.get("type") == "page"][0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send("Network.enable")
        cdp.send("Log.enable")
        cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
        )
        cdp.send("Page.navigate", {"url": URL})
        time.sleep(6)
        cdp.drain(60)

        issues = []
        for ev in cdp.events:
            m = ev.get("method", "")
            p = ev.get("params", {})
            if m == "Runtime.exceptionThrown":
                issues.append("EXC " + json.dumps(p.get("exceptionDetails", {}).get("text"))[:160])
            elif m == "Log.entryAdded":
                e = p.get("entry", {})
                if e.get("level") in ("error", "warning"):
                    issues.append(f"LOG {e.get('level')}: {e.get('text')} [{e.get('url','')}]")
            elif m == "Network.loadingFailed":
                issues.append(f"NET FAIL {p.get('errorText')} {p.get('type')}")
            elif m == "Network.responseReceived":
                r = p.get("response", {})
                if r.get("status", 0) >= 400:
                    issues.append(f"HTTP {r['status']} {r['url']}")

        js = lambda expr: cdp.send(
            "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}
        )["result"].get("value")

        report = json.loads(
            js(
                """(async () => {
              document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
              await new Promise(r => setTimeout(r, 1500));
              const out = {};
              out.title = document.title;
              const meta = name => (document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)||{}).content || null;
              out.meta = {
                description: meta('description'),
                ogTitle: meta('og:title'),
                ogImage: meta('og:image'),
                ogUrl: meta('og:url'),
                twitterCard: meta('twitter:card'),
                canonical: (document.querySelector('link[rel=canonical]')||{}).href || null,
                favicon: (document.querySelector('link[rel~=icon]')||{}).href || null,
                viewport: meta('viewport'),
                themeColor: meta('theme-color'),
                lang: document.documentElement.lang
              };
              const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
                try { return JSON.parse(s.textContent); } catch (e) { return {parseError: String(e)}; }
              });
              out.jsonld = ld;
              out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName + ':' + h.textContent.trim().slice(0,48));
              out.imgs = { total: document.images.length,
                missingAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
                emptyAlt: [...document.images].filter(i => i.alt === '').length,
                largeSizeAttrsMissing: [...document.images].filter(i => !i.getAttribute('width') || !i.getAttribute('height')).length };
              const interactive = [...document.querySelectorAll('a,button,input,select,textarea,[role=button]')]
                .filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
              out.smallTargets = interactive.map(el => {
                const r = el.getBoundingClientRect();
                return { tag: el.tagName, cls: (el.className||'').toString().slice(0,30),
                         label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0,26),
                         w: Math.round(r.width), h: Math.round(r.height) };
              }).filter(o => o.w && o.h && (o.w < 24 || o.h < 24));
              out.noLabel = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
                .filter(el => !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !document.querySelector(`label[for="${el.id}"]`))
                .map(el => el.id || el.name || el.type);
              out.links = [...new Set([...document.querySelectorAll('a[href],img[src],link[href],script[src]')]
                .map(el => el.getAttribute('href') || el.getAttribute('src'))
                .filter(h => h && !h.startsWith('data:') && !h.startsWith('http') && !h.startsWith('mailto') && !h.startsWith('tel') && !h.startsWith('#')))];
              out.resources = performance.getEntriesByType('resource').map(r => ({n: r.name.split('/').pop(), t: r.initiatorType, b: Math.round(r.transferSize)}));
              out.domNodes = document.querySelectorAll('*').length;
              out.scrollW = document.documentElement.scrollWidth;
              out.vw = window.innerWidth;
              out.emptyHref = [...document.querySelectorAll('a')].filter(a => ['', '#', 'javascript:void(0)'].includes(a.getAttribute('href'))).map(a => (a.textContent||'').trim().slice(0,30));
              out.buttontype = [...document.querySelectorAll('button')].filter(b => !b.getAttribute('type')).length;
              return JSON.stringify(out);
            })()"""
            )
        )
        print(json.dumps({"issues": issues, "report": report}, indent=1)[:12000])
    finally:
        proc.terminate()
        proc.wait(timeout=20)


if __name__ == "__main__":
    main()
