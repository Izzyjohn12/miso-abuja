"""Exercise the dine-in split, feedback chat and ambient layer at desktop + mobile."""
import base64
import json
import subprocess
import sys
import time

import requests
from websocket import create_connection

sys.stdout.reconfigure(encoding="utf-8")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8765/index.html"
OUT = r"C:\Users\Israel Agaji\Documents\Qoder\2026-10-25\36877ee0\_work\qa"
SEED = """localStorage.setItem('miso-cart-v1', JSON.stringify(
  [{id:'volcano-roll',qty:2,note:'no wasabi'},{id:'salmon-teriyaki',qty:1,note:''}]))"""
FAILS = []


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

    def js(self, expression):
        result = self.send(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")


def check(label, condition, detail=""):
    if condition:
        print(f"  ok  {label}")
    else:
        FAILS.append(label + (f" — {detail}" if detail else ""))
        print(f"  FAIL {label} — {detail}")


def shot(cdp, name):
    data = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
    with open(f"{OUT}\\{name}.png", "wb") as fh:
        fh.write(base64.b64decode(data))


def start(width, height, mobile, port):
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={port}",
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
    for _ in range(60):
        try:
            requests.get(f"http://127.0.0.1:{port}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        raise RuntimeError("chrome did not start")

    tab = None
    for verb in (requests.put, requests.post):
        try:
            r = verb(f"http://127.0.0.1:{port}/json/new?about:blank", timeout=5)
            if r.ok and r.json().get("webSocketDebuggerUrl"):
                tab = r.json()
                break
        except Exception:
            pass
    if tab is None:
        tab = [t for t in requests.get(f"http://127.0.0.1:{port}/json").json()
               if t.get("type") == "page"][0]

    cdp = CDP(tab["webSocketDebuggerUrl"])
    cdp.send("Page.enable")
    cdp.send("Runtime.enable")
    cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile},
    )
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(3)
    cdp.js(SEED)
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(3)
    cdp.js("document.querySelectorAll('img').forEach(i => i.loading = 'eager')")
    time.sleep(1)
    return proc, cdp


def reset_with_cart(cdp):
    cdp.js("document.getElementById('checkout').hidden || document.getElementById('checkoutClose').click()")
    time.sleep(0.5)
    cdp.js(SEED)
    cdp.send("Page.navigate", {"url": URL})
    time.sleep(2.5)


def open_checkout(cdp):
    cdp.js("document.getElementById('cartTrigger').click()")
    time.sleep(0.4)
    cdp.js("document.getElementById('checkoutStart').click()")
    time.sleep(0.6)


def run(width, height, mobile, tag, port):
    print(f"\n== {width}x{height} {tag} ==")
    proc, cdp = start(width, height, mobile, port)
    try:
        cdp.js("document.documentElement.style.scrollBehavior = 'auto'")
        # ambient + responsive shell
        ambient = cdp.js("getComputedStyle(document.querySelector('.ambient')).backgroundImage")
        check("ambient image applied", "room-blur.webp" in ambient)
        resources = json.loads(cdp.js(
            "JSON.stringify(performance.getEntriesByType('resource').map(e => e.name))"
        ))
        check("ambient image fetched", any("room-blur.webp" in r for r in resources), str(resources[-3:]))
        overflow = cdp.js("document.documentElement.scrollWidth - window.innerWidth")
        check("no horizontal overflow", overflow <= 0, f"{overflow}px")

        for name, selector in [
            (f"{tag}-top", "#top"),
            (f"{tag}-menu", "#menu"),
            (f"{tag}-visit", "#visit"),
            (f"{tag}-footer", "footer"),
        ]:
            cdp.js(f"window.scrollTo(0, document.querySelector({json.dumps(selector)}).getBoundingClientRect().top + scrollY)")
            time.sleep(0.9)
            shot(cdp, name)

        # ---- dine-in: no details, no upfront payment -------------------
        open_checkout(cdp)
        state = json.loads(cdp.js("""JSON.stringify({
          contactHidden: document.querySelector('[data-contact-field]').hidden,
          nameDisabled: document.getElementById('customerName').disabled,
          review: document.getElementById('reviewOrderLabel').textContent,
          detailsNote: document.getElementById('detailsNote').textContent,
          summaryNote: document.getElementById('summaryNote').textContent,
          totalLabel: document.getElementById('summaryTotalLabel').textContent
        })"""))
        check("dine-in hides contact fields", state["contactHidden"] and state["nameDisabled"])
        check("dine-in review copy", state["review"] == "Review table order", state["review"])
        check("dine-in step named Table",
              cdp.js("document.getElementById('step1Name').textContent") == "Table" and
              cdp.js("document.getElementById('checkoutTitle').textContent") == "Your table")
        check("dine-in summary note", "pay before or after" in state["summaryNote"], state["summaryNote"])
        check("dine-in amount label", state["totalLabel"] == "Amount due", state["totalLabel"])
        shot(cdp, f"{tag}-dine-1")

        cdp.js("document.getElementById('detailsForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        time.sleep(0.5)
        pay = json.loads(cdp.js("""JSON.stringify({
          step2: !document.querySelector('[data-step-panel="2"]').hidden,
          heading: document.getElementById('paymentHeading').textContent,
          lead: document.getElementById('paymentLead').textContent,
          amountLabel: document.getElementById('bankAmountLabel').textContent,
          continueDisabled: document.getElementById('paymentContinue').disabled,
          confirmHidden: document.getElementById('transferConfirmRow').hidden,
          laterHidden: document.getElementById('payLaterNote').hidden,
          amount: document.getElementById('bankAmount').textContent,
          bank: document.getElementById('bankName').textContent,
          account: document.getElementById('bankAccountNumber').textContent
        })"""))
        check("dine-in reaches payment without details", pay["step2"])
        check("dine-in pay copy", pay["heading"] == "Pay now or after your meal", pay["heading"])
        check("dine-in amount label", pay["amountLabel"] == "Amount due", pay["amountLabel"])
        check("dine-in can continue", pay["continueDisabled"] is False)
        check("dine-in hides transfer confirmation", pay["confirmHidden"] is True)
        check("dine-in pay-later note visible", pay["laterHidden"] is False)
        check("real bank displayed", pay["bank"] == "Moniepoint" and pay["account"] == "5945221845", str(pay))
        cdp.js("document.querySelector('.checkout__body').scrollTop = 0")
        time.sleep(0.5)
        shot(cdp, f"{tag}-dine-2")

        cdp.js("document.getElementById('paymentContinue').click()")
        time.sleep(0.7)
        final = json.loads(cdp.js("""JSON.stringify({
          step3: !document.querySelector('[data-step-panel="3"]').hidden,
          heading: document.getElementById('confirmHeading').textContent,
          handoff: document.querySelector('#confirmActions a').textContent.trim(),
          href: decodeURIComponent(document.querySelector('#confirmActions a').href),
          summaryNote: document.getElementById('summaryNote').textContent,
          totalLabel: document.getElementById('summaryTotalLabel').textContent,
          cart: document.getElementById('cartCount').textContent
        })"""))
        check("dine-in reaches send step", final["step3"])
        check("dine-in handoff label", "table order" in final["handoff"].lower(), final["handoff"])
        check("dine-in order has no guest details", "Guest:" not in final["href"] and "Phone:" not in final["href"])
        check("dine-in order says no receipt", "no receipt needed" in final["href"])
        check("dine-in order includes bank", "5945221845" in final["href"])
        check("cart cleared after order", final["cart"] == "0", final["cart"])
        shot(cdp, f"{tag}-dine-3")

        # ---- pickup: details + payment gate ---------------------------
        reset_with_cart(cdp)
        open_checkout(cdp)
        cdp.js("""(() => { const r=document.querySelector('input[name=service][value="pickup"]');
          r.checked=true; r.dispatchEvent(new Event('change',{bubbles:true})); })()""")
        time.sleep(0.4)
        state = json.loads(cdp.js("""JSON.stringify({
          contactHidden: document.querySelector('[data-contact-field]').hidden,
          nameDisabled: document.getElementById('customerName').disabled,
          review: document.getElementById('reviewOrderLabel').textContent
        })"""))
        check("pickup asks for contact", state["contactHidden"] is False and state["nameDisabled"] is False)
        check("pickup review copy", state["review"] == "Review order", state["review"])
        check("pickup step named Details",
              cdp.js("document.getElementById('step1Name').textContent") == "Details" and
              cdp.js("document.getElementById('checkoutTitle').textContent") == "Your details")
        cdp.js("document.getElementById('detailsForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        time.sleep(0.4)
        blocked = json.loads(cdp.js("""JSON.stringify({
          step2: !document.querySelector('[data-step-panel="2"]').hidden,
          nameErr: document.querySelector('[data-error-for="customerName"]').textContent,
          pickupErr: document.querySelector('[data-error-for="pickupTime"]').textContent
        })"""))
        check("pickup blocked without details", blocked["step2"] is False)
        check("pickup errors shown", bool(blocked["nameErr"]) and bool(blocked["pickupErr"]), str(blocked))
        shot(cdp, f"{tag}-pickup-1")

        cdp.js("""(() => {
          const set=(id,v)=>{const el=document.getElementById(id); el.value=v;
            el.dispatchEvent(new Event('input',{bubbles:true}));};
          set('pickupTime','In 1 hour'); set('customerName','Ada Okonkwo'); set('customerPhone','08031234567');
          document.getElementById('detailsForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        })()""")
        time.sleep(0.5)
        gate = json.loads(cdp.js("""JSON.stringify({
          step2: !document.querySelector('[data-step-panel="2"]').hidden,
          continueDisabled: document.getElementById('paymentContinue').disabled,
          confirmHidden: document.getElementById('transferConfirmRow').hidden,
          laterHidden: document.getElementById('payLaterNote').hidden,
          heading: document.getElementById('paymentHeading').textContent,
          total: document.getElementById('summaryTotal').textContent
        })"""))
        check("pickup reaches payment", gate["step2"])
        check("pickup requires transfer confirmation", gate["continueDisabled"] is True and gate["confirmHidden"] is False)
        check("pickup hides dine-in note", gate["laterHidden"] is True)
        check("pickup pay copy", gate["heading"] == "Pay by bank transfer", gate["heading"])
        cdp.js("document.getElementById('paymentContinue').click()")
        time.sleep(0.4)
        check("pickup cannot skip payment", cdp.js("!document.querySelector('[data-step-panel=\"3\"]').hidden") is False)
        cdp.js("""(() => { const c=document.getElementById('transferConfirm'); c.checked=true;
          c.dispatchEvent(new Event('change',{bubbles:true})); })()""")
        cdp.js("document.getElementById('paymentContinue').click()")
        time.sleep(0.6)
        final = json.loads(cdp.js("""JSON.stringify({
          step3: !document.querySelector('[data-step-panel="3"]').hidden,
          href: decodeURIComponent(document.querySelector('#confirmActions a').href)
        })"""))
        check("pickup reaches send after confirmation", final["step3"])
        check("pickup order has guest + receipt", "Guest: Ada" in final["href"] and "receipt attached" in final["href"])
        shot(cdp, f"{tag}-pickup-3")

        # ---- feedback without leaving the page ------------------------
        cdp.js("document.getElementById('finishCheckout').click()")
        time.sleep(0.5)
        cdp.js("document.querySelector('.footer__nav [data-feedback]').click()")
        time.sleep(0.5)
        fb = json.loads(cdp.js("""JSON.stringify({
          open: !document.getElementById('feedback').hidden,
          triggers: document.querySelectorAll('[data-feedback]').length,
          focused: document.activeElement.id
        })"""))
        check("feedback opens from footer", fb["open"] and fb["triggers"] >= 2, str(fb))
        shot(cdp, f"{tag}-feedback")

        cdp.js("document.getElementById('feedbackForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        time.sleep(0.3)
        check("feedback requires a message",
              cdp.js("document.querySelector('[data-error-for=\"feedbackMessage\"]').textContent") != "")

        cdp.js("""(() => {
          window.__wa = null;
          const orig = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.href && this.href.indexOf('wa.me') !== -1) { window.__wa = this.href; return; }
            return orig.call(this);
          };
          document.querySelector('input[name=rating][value="Loved it"]').checked = true;
          document.getElementById('feedbackName').value = 'Ada';
          document.getElementById('feedbackMessage').value = 'The tom yum was excellent. More vegetarian small plates, please.';
          document.getElementById('feedbackForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        })()""")
        time.sleep(0.6)
        wa = cdp.js("window.__wa ? decodeURIComponent(window.__wa) : ''")
        check("feedback builds a WhatsApp message", "Hello MISO" in wa and "Loved it" in wa and "tom yum" in wa, wa[:160])
        check("feedback closes after opening WhatsApp", cdp.js("document.getElementById('feedback').hidden") is True)

        # ---- final network + console sanity --------------------------
        failed = cdp.js("""JSON.stringify(performance.getEntriesByType('resource')
          .filter(e => e.name.indexOf(location.origin) === 0 && e.responseStatus >= 400)
          .map(e => e.name))""")
        check("all local resources loaded", failed == "[]", failed)
        check("display fonts loaded", cdp.js("document.fonts.check('16px \"Bodoni Moda\"')") is True)
        print("  page height:", cdp.js("document.documentElement.scrollHeight"))
    finally:
        proc.terminate()

    time.sleep(1)


if __name__ == "__main__":
    run(1440, 900, False, "desktop", 9355)
    run(390, 844, True, "mobile", 9356)
    print("\nFAILURES:", len(FAILS))
    for f in FAILS:
        print(" -", f)
