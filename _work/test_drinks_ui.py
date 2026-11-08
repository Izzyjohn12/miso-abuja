"""Drinks menu UI checks: guest menu, cart, mobile layout and staff editor.

Read-only apart from adding drinks to a browser-local cart. Run against
`wrangler pages dev` on 8788.
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
BASE = os.environ.get("MISO_TEST_BASE", "http://127.0.0.1:8788")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")


def load_passcode():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "staff-passcode.txt")
    try:
        with open(path, encoding="utf-8") as fh:
            match = re.search(r"MISO-[A-Z0-9-]+", fh.read())
            return match.group(0) if match else ""
    except OSError:
        return ""


PASSCODE = os.environ.get("MISO_TEST_PASSCODE") or load_passcode()
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
            time.sleep(0.25)
        return False

    def shot(self, path):
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))


def launch(port, width=1440, height=1100, mobile=False, url="/?drinks-ui=1"):
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            f"--window-size={width},{height}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                requests.get(f"http://127.0.0.1:{port}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        tab = [t for t in requests.get(f"http://127.0.0.1:{port}/json").json()
               if t.get("type") == "page"][0]
        cdp = CDP(tab["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": mobile,
        })
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__errors = [];
          window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
          window.addEventListener('unhandledrejection', function (e) {
            window.__errors.push('rejection:' + String(e.reason));
          });
        """})
        cdp.send("Page.navigate", {"url": BASE + url})
        ready = (
            "document.readyState === 'complete' && Boolean(document.getElementById('loginButton'))"
            if url.startswith("/staff/")
            else "document.readyState === 'complete' && document.querySelectorAll('#menu-drinks .menu-item').length === 59"
        )
        if not cdp.wait_for(ready, 40):
            raise RuntimeError("page did not render")
        time.sleep(1)
        return cdp, proc
    except Exception:
        proc.terminate()
        raise


def stop(proc):
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=15)


def scroll_to(cdp, selector, offset=120):
    cdp.js(
        "(function(){var el=document.querySelector(%s);"
        "window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - %d);"
        "return true;})()" % (json.dumps(selector), offset)
    )
    time.sleep(0.8)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = {}

    cdp, proc = launch(9362, 1440, 1100)
    try:
        out["tabs"] = cdp.js("[...document.querySelectorAll('.menu-tab')].map(b=>b.textContent.trim())")
        out["status"] = cdp.js("document.getElementById('menuStatus').textContent")
        out["counts"] = cdp.js("""({
          drinks: document.querySelectorAll('#menu-drinks .menu-item').length,
          spirits: document.querySelectorAll('#menu-spirits .menu-item').length,
          wine: document.querySelectorAll('#menu-wine .menu-item').length
        })""")

        scroll_to(cdp, "#menu-drinks")
        cdp.js("""(function(){
          document.querySelectorAll('#menu-drinks img, #menu-spirits img, #menu-wine img').forEach(function(i){
            i.loading='eager'; i.src=i.getAttribute('src');
          });
          return true;
        })()""")
        time.sleep(1.5)
        out["heroes"] = cdp.js("""[...document.querySelectorAll('#menu-drinks img, #menu-spirits img, #menu-wine img')]
          .map(i => ({src: i.currentSrc.split('/').pop(), w: i.naturalWidth, complete: i.complete}))""")
        cdp.shot(os.path.join(OUT, "drinks-category-1440.png"))

        # Search narrows the full menu to the two mojitos.
        cdp.js("""(function(){
          var q=document.getElementById('menuSearch');
          q.value='mojito';
          q.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()""")
        out["searchTwo"] = cdp.wait_for(
            "document.getElementById('menuStatus').textContent.indexOf('2 items match') === 0", 8
        )
        out["searchStatus"] = cdp.js("document.getElementById('menuStatus').textContent")
        out["visibleMojitos"] = cdp.js("""[...document.querySelectorAll('.menu-item')]
          .filter(li => !li.hidden && li.offsetParent !== null).map(li => li.dataset.name)""")

        cdp.js("""(function(){
          var q=document.getElementById('menuSearch');
          q.value='';
          q.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()""")
        cdp.wait_for("document.getElementById('menuStatus').textContent.indexOf('281 dishes & drinks') === 0", 8)

        # Add three drinks and check the cart totals.
        cdp.js("""(function(){
          ['mojito','chivita-orange-glass','shot-belvedere'].forEach(function(id){
            document.querySelector('[data-add="' + id + '"]').click();
          });
          return true;
        })()""")
        out["cartCount"] = cdp.wait_for("document.getElementById('cartCount').textContent === '3'", 8)
        cdp.js("document.getElementById('cartTrigger').click(); true")
        out["drawerOpen"] = cdp.wait_for("!document.getElementById('cartDrawer').hidden", 8)
        out["subtotal"] = cdp.js("document.getElementById('cartSubtotal').textContent")
        out["cartLines"] = cdp.js("""[...document.querySelectorAll('.cart-line')].map(function(li){
          return li.querySelector('.cart-line__title').textContent + ' | ' +
            li.querySelector('.cart-line__meta').textContent + ' | ' +
            li.querySelector('.cart-line__total').textContent;
        })""")
        cdp.shot(os.path.join(OUT, "drinks-cart-1440.png"))
        out["desktopErrors"] = cdp.js("window.__errors")
    finally:
        stop(proc)

    cdp, proc = launch(9363, 390, 844, mobile=True)
    try:
        out["mobileCounts"] = cdp.js("""({
          drinks: document.querySelectorAll('#menu-drinks .menu-item').length,
          spirits: document.querySelectorAll('#menu-spirits .menu-item').length,
          wine: document.querySelectorAll('#menu-wine .menu-item').length
        })""")
        scroll_to(cdp, "#menu-drinks", 90)
        cdp.js("""(function(){
          document.querySelectorAll('#menu-drinks img').forEach(function(i){ i.loading='eager'; i.src=i.getAttribute('src'); });
          return true;
        })()""")
        time.sleep(1)
        out["mobileHero"] = cdp.js("""(function(){var i=document.querySelector('#menu-drinks img');
          return {src:i.currentSrc.split('/').pop(), w:i.naturalWidth, complete:i.complete};})()""")
        out["mobileOverflow"] = cdp.js(
            "document.documentElement.scrollWidth - window.innerWidth"
        )
        cdp.shot(os.path.join(OUT, "drinks-category-390.png"))
        out["mobileErrors"] = cdp.js("window.__errors")
    finally:
        stop(proc)

    cdp, proc = launch(9364, 390, 844, mobile=True, url="/staff/")
    try:
        cdp.wait_for("Boolean(document.getElementById('loginButton'))", 30)
        cdp.js("""(function(){
          document.getElementById('passcode').value=%s;
          document.getElementById('loginButton').click();
          return true;
        })()""" % json.dumps(PASSCODE))
        out["loggedIn"] = cdp.wait_for("!document.getElementById('appView').hidden", 30)
        cdp.js("document.querySelector('[data-tab=\"menu\"]').click(); true")
        out["menuTab"] = cdp.wait_for("!document.getElementById('viewMenu').hidden", 8)
        out["staffTotal"] = cdp.wait_for(
            "document.getElementById('menuTotal').textContent.indexOf('281 items') === 0", 10
        )
        out["staffTotalText"] = cdp.js("document.getElementById('menuTotal').textContent")

        cdp.js("""(function(){
          var q=document.getElementById('menuSearch');
          q.value='mojito';
          q.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()""")
        time.sleep(0.6)
        out["staffMojitos"] = cdp.js("""[...document.querySelectorAll('#menuList .dish-row')]
          .filter(li => li.offsetParent !== null)
          .map(li => li.querySelector('.dish-row__name').textContent.trim())""")
        cdp.js("""(function(){
          var q=document.getElementById('menuSearch');
          q.value='';
          q.dispatchEvent(new Event('input', {bubbles:true}));
          var cat=[...document.querySelectorAll('#menuList .menu-cat')].find(function(d){
            return d.querySelector('.menu-cat__name').textContent.trim()==='Drinks';
          });
          if(cat){ window.scrollTo(0, cat.getBoundingClientRect().top + window.scrollY - 100); }
          return true;
        })()""")
        time.sleep(1)
        out["staffDrinkGroups"] = cdp.js("""(function(){
          var cat=[...document.querySelectorAll('#menuList .menu-cat')].find(function(d){
            return d.querySelector('.menu-cat__name').textContent.trim()==='Drinks';
          });
          return cat ? [...cat.querySelectorAll('.menu-group h4')].map(h=>h.textContent.trim()) : [];
        })()""")
        cdp.shot(os.path.join(OUT, "staff-drinks-menu-390.png"))

        cdp.js("document.getElementById('addDishButton').click(); true")
        out["sheetOpen"] = cdp.wait_for("!document.getElementById('dishSheet').hidden", 8)
        out["sheetCopy"] = cdp.js("""({
          kicker: document.getElementById('dishSheetKicker').textContent,
          title: document.getElementById('dishSheetTitle').textContent,
          save: document.getElementById('dishSave').textContent
        })""")
        out["groups"] = cdp.js("""[...document.querySelectorAll('#dishGroup optgroup')]
          .map(g => g.getAttribute('label'))""")
        out["drinkGroupOptions"] = cdp.js("""(function(){
          var g=[...document.querySelectorAll('#dishGroup optgroup')].find(x=>x.getAttribute('label')==='Drinks');
          return g ? [...g.querySelectorAll('option')].map(o=>o.textContent.trim()) : [];
        })()""")
        out["staffErrors"] = cdp.js("window.__errors")
    finally:
        stop(proc)

    print(json.dumps(out, indent=2, ensure_ascii=False))

    failures = []
    if len(out.get("tabs", [])) != 9:
        failures.append("expected 9 menu tabs")
    if out.get("status") != "281 dishes & drinks · 9 sections · prices in naira":
        failures.append("bad guest status")
    if out.get("counts") != {"drinks": 59, "spirits": 70, "wine": 38}:
        failures.append("bad category item counts")
    if not all(h.get("complete") and h.get("w", 0) > 0 for h in out.get("heroes", [])):
        failures.append("category hero images did not load")
    if not out.get("searchTwo"):
        failures.append("mojito search did not return 2 items")
    if out.get("subtotal") != "₦27,000":
        failures.append("cart subtotal is not 27,000")
    if not out.get("cartCount"):
        failures.append("cart did not reach 3 items")
    if out.get("desktopErrors") or out.get("mobileErrors") or out.get("staffErrors"):
        failures.append("console errors found")
    if out.get("mobileOverflow", 1) > 0:
        failures.append("mobile horizontal overflow")
    if out.get("mobileHero", {}).get("w", 0) <= 0:
        failures.append("mobile drinks hero did not load")
    if out.get("staffTotalText") != "281 items":
        failures.append("staff menu count is wrong")
    if out.get("staffMojitos") != ["Mojito", "Virgin Mojito"]:
        failures.append("staff mojito search is wrong")
    if "Shisha & cigars" not in out.get("drinkGroupOptions", []):
        failures.append("staff add-item groups are missing drinks")
    if out.get("sheetCopy", {}).get("save", "").strip() != "Save item":
        failures.append("staff sheet copy is not item-based")

    if failures:
        print("\nFAILURES:\n- " + "\n- ".join(failures))
        sys.exit(1)
    print("\nAll drinks UI checks passed.")


if __name__ == "__main__":
    main()
