"""Phase 4 browser test — ring-until-acknowledged alarm, vibration and the
staff app shell. Read-write against the local D1 only; reset it afterwards."""
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
PORT = 9357
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")


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

INSTRUMENT = r"""
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
window.addEventListener('unhandledrejection', function (e) {
  window.__errs.push('rejection:' + String(e.reason));
});
window.__vibes = [];
try {
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: function (pattern) { window.__vibes.push(pattern); return true; }
  });
} catch (error) {}
window.__audio = { sources: 0, starts: 0, stops: 0, loops: 0 };
(function () {
  var Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  function Wrapped() {
    var ctx = new Orig();
    var make = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = function () {
      var source = make();
      window.__audio.sources += 1;
      var start = source.start.bind(source);
      source.start = function () {
        window.__audio.starts += 1;
        if (source.loop) window.__audio.loops += 1;
        return start.apply(source, arguments);
      };
      var stop = source.stop.bind(source);
      source.stop = function () {
        window.__audio.stops += 1;
        return stop.apply(source, arguments);
      };
      return source;
    };
    return ctx;
  }
  Wrapped.prototype = Orig.prototype;
  window.AudioContext = Wrapped;
  window.webkitAudioContext = Wrapped;
})();
"""


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


def seed_order():
    response = requests.post(
        BASE + "/api/orders",
        json={
            "ref": "MISO-261108-0901",
            "clientToken": "phase4-alarm-seed-1",
            "service": "pickup",
            "details": {"name": "Alarm Test", "phone": "08012345678", "pickupTime": "9:00 PM"},
            "lines": [{"id": "ebi-fry", "qty": 1}],
        },
        headers={"X-MISO-CSRF": "1", "Origin": BASE},
        timeout=20,
    )
    return {"status": response.status_code, "body": response.text[:300]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = {"seedStatus": seed_order()}

    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--force-prefers-reduced-motion",
            "--autoplay-policy=no-user-gesture-required",
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
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": INSTRUMENT})

        cdp.send("Page.navigate", {"url": BASE + "/staff/"})
        out["loaded"] = cdp.wait_for(
            "document.readyState === 'complete' && Boolean(document.getElementById('loginButton'))",
            40,
        )
        time.sleep(1)

        cdp.js(
            "(function(){document.getElementById('passcode').value=" + json.dumps(PASSCODE) +
            ";document.getElementById('loginButton').click();return true;})()"
        )
        out["loggedIn"] = cdp.wait_for("!document.getElementById('appView').hidden", 30)

        out["ringing"] = cdp.wait_for(
            "document.body.classList.contains('is-ringing') && "
            "!document.getElementById('alarmBanner').hidden", 30
        )
        out["alarmText"] = cdp.js("document.getElementById('alarmText').textContent")
        out["vibrationCalls"] = json.loads(cdp.js("JSON.stringify(window.__vibes)"))
        out["audioStarted"] = cdp.wait_for("window.__audio && window.__audio.starts > 0", 15)
        out["audio"] = json.loads(cdp.js("JSON.stringify(window.__audio)"))
        out["newOrders"] = cdp.js("document.querySelectorAll('.order--new').length")
        cdp.shot(os.path.join(OUT, "phase4-ringing-390.png"))

        # Staff acknowledges from the queue.
        cdp.js(
            "(function(){var b=document.querySelector('.order--new [data-status=preparing]');"
            "if (b) b.click(); return Boolean(b);})()"
        )
        out["acknowledged"] = cdp.wait_for(
            "!document.body.classList.contains('is-ringing') && "
            "document.getElementById('alarmBanner').hidden", 30
        )
        out["audioAfterAck"] = json.loads(cdp.js("JSON.stringify(window.__audio)"))
        out["vibrationAfterAck"] = json.loads(cdp.js("JSON.stringify(window.__vibes)"))
        out["statusAfterAck"] = cdp.js(
            "(function(){var c=document.querySelector('.order--preparing .chip--preparing');"
            "return c ? c.textContent : '';})()"
        )
        cdp.shot(os.path.join(OUT, "phase4-ack-390.png"))

        # App shell is cached; order data is not.
        out["staffShellCached"] = cdp.js(
            "caches.match('/staff/staff.js').then(function (hit) { return Boolean(hit); })"
        )
        out["staffIndexCached"] = cdp.js(
            "caches.match('/staff/index.html').then(function (hit) { return Boolean(hit); })"
        )
        out["apiCached"] = cdp.js(
            "caches.match('/api/orders').then(function (hit) { return Boolean(hit); })"
        )
        out["controller"] = cdp.js(
            "navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null"
        )
        out["errors"] = cdp.js("JSON.stringify(window.__errs || [])")

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
