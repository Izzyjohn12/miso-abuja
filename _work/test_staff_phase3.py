"""Phase 3 browser test — staff Menu and Alerts tabs, dish create/edit/hide.

Run against the local `wrangler pages dev` server after resetting local D1.
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
BASE = "http://127.0.0.1:8788"
PORT = 9355
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


def seed_order():
    response = requests.post(
        BASE + "/api/orders",
        json={
            "ref": "MISO-261107-0777",
            "clientToken": "phase3-browser-seed-1",
            "service": "pickup",
            "details": {"name": "Browser Guest", "phone": "08012345678", "pickupTime": "8:30 PM"},
            "lines": [{"id": "ebi-fry", "qty": 1}],
        },
        headers={"X-MISO-CSRF": "1", "Origin": BASE},
        timeout=20,
    )
    return response.status_code


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = {}
    out["seedStatus"] = seed_order()

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
        cdp.send("Page.navigate", {"url": BASE + "/staff/?e2e=" + stamp})
        time.sleep(2)

        out["loginVisible"] = cdp.wait_for(
            "document.activeElement && document.activeElement.id === 'passcode'", 20
        )
        cdp.js("document.getElementById('passcode').value = " + json.dumps(PASSCODE))
        cdp.js("document.getElementById('loginForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
        out["staffLoggedIn"] = cdp.wait_for(
            "!document.getElementById('appView').hidden && document.querySelectorAll('.order').length > 0",
            25,
        )

        out["tabs"] = json.loads(cdp.js("""JSON.stringify({
          labels: [...document.querySelectorAll('.tab')].map(b => b.textContent.trim().split(' ')[0]),
          active: document.querySelector('.tab.is-active').textContent.trim().split(' ')[0],
          title: document.title,
          topbar: document.getElementById('topbarTitle').textContent,
          manifest: document.querySelector('link[rel=manifest]').getAttribute('href')
        })"""))
        out["orderAlertNote"] = cdp.js(
            "(() => { const el = document.querySelector('.order__alert'); return el ? el.textContent.trim() : ''; })()"
        )
        out["tabBadge"] = cdp.js("document.getElementById('ordersTabCount').textContent")
        cdp.shot(os.path.join(OUT, "phase3-orders-390.png"))

        # ---------------------------------------------------------- menu --
        cdp.js("document.querySelector('.tab[data-tab=menu]').click()")
        out["menuVisible"] = cdp.wait_for(
            "!document.getElementById('viewMenu').hidden && document.querySelectorAll('.menu-cat').length === 9",
            25,
        )
        out["menuHeader"] = json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          topbar: document.getElementById('topbarTitle').textContent,
          total: document.getElementById('menuTotal').textContent,
          categories: [...document.querySelectorAll('.menu-cat__name')].map(el => el.textContent),
          addVisible: Boolean(document.getElementById('addDishButton').offsetParent)
        })"""))
        out["overflowMenu"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )

        cdp.js("""(() => {
          const input = document.getElementById('menuSearch');
          input.value = 'phad thai';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        })()""")
        time.sleep(0.4)
        out["search"] = json.loads(cdp.js("""JSON.stringify({
          total: document.getElementById('menuTotal').textContent,
          rows: [...document.querySelectorAll('.dish-row')].map(row => ({
            name: row.querySelector('.dish-row__name').textContent.trim(),
            meta: row.querySelector('.dish-row__meta').textContent
          }))
        })"""))
        cdp.shot(os.path.join(OUT, "phase3-menu-search-390.png"))

        cdp.js("""(() => {
          const input = document.getElementById('menuSearch');
          input.value = '';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        })()""")
        time.sleep(0.3)

        # Add a dish.
        cdp.js("document.getElementById('addDishButton').click()")
        out["sheetOpen"] = cdp.wait_for("!document.getElementById('dishSheet').hidden", 5)
        out["groupCount"] = cdp.js(
            "document.querySelectorAll('#dishGroup option').length"
        )
        cdp.js("""(() => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            el.value = value;
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
          };
          set('dishName', 'E2E Test Dish');
          set('dishGroup', 'japanese/small-plates');
          set('dishPrice', '4321');
          set('dishDescription', 'Added by the Phase 3 browser test.');
          const tag = document.querySelector('input[name=dishTag][value=spicy]');
          tag.checked = true;
        })()""")
        cdp.shot(os.path.join(OUT, "phase3-dish-sheet-390.png"))
        cdp.js("document.getElementById('dishForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
        out["created"] = cdp.wait_for("document.getElementById('dishSheet').hidden", 20)
        out["createToast"] = cdp.js("document.getElementById('toast').textContent")
        out["createdInMenu"] = cdp.wait_for(
            "document.body.textContent.indexOf('E2E Test Dish') !== -1", 20
        )

        # Find the new row and edit it.
        cdp.js("""(() => {
          const input = document.getElementById('menuSearch');
          input.value = 'E2E Test Dish';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        })()""")
        time.sleep(0.4)
        out["createdRow"] = json.loads(cdp.js("""JSON.stringify((() => {
          const row = document.querySelector('.dish-row');
          if (!row) return null;
          return {
            name: row.querySelector('.dish-row__name').textContent.trim(),
            meta: row.querySelector('.dish-row__meta').textContent,
            desc: row.querySelector('.dish-row__desc') ? row.querySelector('.dish-row__desc').textContent : '',
            id: row.querySelector('[data-menu-act=edit]').getAttribute('data-id'),
            actions: [...row.querySelectorAll('.dish-btn')].map(b => b.textContent.trim())
          };
        })())"""))

        cdp.js("document.querySelector('.dish-row [data-menu-act=edit]').click()")
        out["editSheet"] = cdp.wait_for("!document.getElementById('dishSheet').hidden", 5)
        out["editPrefill"] = json.loads(cdp.js("""JSON.stringify({
          title: document.getElementById('dishSheetTitle').textContent,
          name: document.getElementById('dishName').value,
          group: document.getElementById('dishGroup').value,
          price: document.getElementById('dishPrice').value,
          request: document.getElementById('dishRequest').checked,
          spicy: document.querySelector('input[name=dishTag][value=spicy]').checked
        })"""))
        cdp.js("""(() => {
          document.getElementById('dishPrice').value = '5555';
          document.getElementById('dishName').value = 'E2E Test Dish Edited';
          document.getElementById('dishName').dispatchEvent(new Event('input', {bubbles: true}));
          document.getElementById('dishForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
        })()""")
        out["edited"] = cdp.wait_for("document.getElementById('dishSheet').hidden", 20)
        time.sleep(0.6)
        out["editedMeta"] = cdp.js(
            "document.querySelector('.dish-row__meta') ? document.querySelector('.dish-row__meta').textContent : ''"
        )
        out["editedName"] = cdp.js(
            "document.querySelector('.dish-row__name') ? document.querySelector('.dish-row__name').textContent.trim() : ''"
        )

        # Hide it (confirm is auto-accepted in the page).
        created_id = out["createdRow"]["id"] if out.get("createdRow") else ""
        cdp.js("window.confirm = function () { return true; }")
        cdp.js("document.querySelector('.dish-row [data-menu-act=hide]').click()")
        out["hidden"] = cdp.wait_for(
            "document.querySelector('.dish-row.is-hidden') !== null", 20
        )
        out["hideToast"] = cdp.js("document.getElementById('toast').textContent")
        cdp.shot(os.path.join(OUT, "phase3-menu-hidden-390.png"))

        guest_hidden = requests.get(BASE + "/api/menu", timeout=20).text
        out["guestHidden"] = ('"id":"' + created_id + '"') not in guest_hidden if created_id else False

        # Restore it.
        cdp.js("document.querySelector('.dish-row [data-menu-act=show]').click()")
        out["restored"] = cdp.wait_for(
            "document.querySelector('.dish-row.is-hidden') === null", 20
        )
        time.sleep(0.4)
        guest_shown = requests.get(BASE + "/api/menu", timeout=20).text
        out["guestShown"] = ('"id":"' + created_id + '"') in guest_shown if created_id else False

        cdp.shot(os.path.join(OUT, "phase3-menu-390.png"))
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False,
        })
        time.sleep(1)
        cdp.shot(os.path.join(OUT, "phase3-menu-desktop.png"))
        out["overflowMenuDesktop"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )

        # -------------------------------------------------------- alerts --
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True,
        })
        cdp.js("document.querySelector('.tab[data-tab=alerts]').click()")
        out["alertsVisible"] = cdp.wait_for(
            "!document.getElementById('viewAlerts').hidden && "
            "document.getElementById('alertDeviceStatus').textContent.indexOf('Checking') === -1",
            25,
        )
        time.sleep(1)
        out["alerts"] = json.loads(cdp.js("""JSON.stringify({
          title: document.title,
          status: document.getElementById('alertDeviceStatus').textContent,
          permission: document.getElementById('alertPermission').textContent,
          devices: document.getElementById('alertDeviceCount').textContent,
          lastDelivery: document.getElementById('alertLastDelivery').textContent,
          enableVisible: !document.getElementById('enablePushButton').hidden,
          disableVisible: !document.getElementById('disablePushButton').hidden,
          testVisible: !document.getElementById('testPushButton').hidden,
          installHint: document.getElementById('installHint').textContent,
          iconHead: document.querySelector('#alertDeviceStatus').closest('.alert-card__head').className
        })"""))
        out["overflowAlerts"] = cdp.js(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        cdp.shot(os.path.join(OUT, "phase3-alerts-390.png"))

        # Back to orders via the "Set up alerts" shortcut when present.
        cdp.js("document.querySelector('.tab[data-tab=orders]').click()")
        out["backToOrders"] = cdp.wait_for("!document.getElementById('viewOrders').hidden", 5)
        out["ordersTitle"] = cdp.js("document.title")
        cdp.shot(os.path.join(OUT, "phase3-orders-return-390.png"))

        out["errors"] = cdp.js("JSON.stringify(window.__misoErrors || [])")
        out["titleAtEnd"] = cdp.js("document.title")

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
