"""Staff PWA install onboarding — login card, iPhone steps, top-bar help,
QR asset and installed-state awareness. Read-only against the local D1."""
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
IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)


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


def run_scenario(port, setup_script=None, user_agent=None):
    """Open /staff/, run optional pre-page injection, and return a logged-in CDP."""
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--no-first-run",
            "--window-size=500,900",
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
        if user_agent:
            cdp.send("Emulation.setUserAgentOverride", {"userAgent": user_agent})
        cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__errors = [];
          window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
          window.addEventListener('unhandledrejection', function (e) {
            window.__errors.push('rejection:' + String(e.reason));
          });
        """})
        if setup_script:
            cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": setup_script})

        cdp.send("Page.navigate", {"url": BASE + "/staff/"})
        if not cdp.wait_for(
            "document.readyState === 'complete' && Boolean(document.getElementById('loginButton'))",
            40,
        ):
            raise RuntimeError("staff login did not load")
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


def login(cdp):
    cdp.js(
        "(function(){document.getElementById('passcode').value=" + json.dumps(PASSCODE) +
        ";document.getElementById('loginButton').click();return true;})()"
    )
    return cdp.wait_for("!document.getElementById('appView').hidden", 30)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = {}

    # 1. Desktop Chrome, not installed, with a captured install prompt.
    cdp, proc = run_scenario(9358)
    try:
        out["loginCardVisible"] = cdp.js(
            "!document.getElementById('loginInstallCard').hidden"
        )
        out["loginHint"] = cdp.js("document.getElementById('loginInstallHint').textContent")
        out["promptButtonHiddenFirst"] = cdp.js(
            "document.getElementById('loginInstallButton').hidden"
        )
        out["qrAsset"] = json.loads(cdp.js("""fetch('/assets/img/app/staff-install-qr.svg')
          .then(async (r) => JSON.stringify({status: r.status,
            svg: (await r.text()).indexOf('<svg') !== -1}))"""))
        cdp.shot(os.path.join(OUT, "staff-install-login-390.png"))

        cdp.js("""(function(){
          window.__prompted = 0;
          var e = new Event('beforeinstallprompt');
          e.prompt = function () { window.__prompted += 1; };
          e.userChoice = Promise.resolve({ outcome: 'accepted' });
          window.dispatchEvent(e);
          return true;
        })()""")
        out["promptButtonShown"] = cdp.wait_for(
            "!document.getElementById('loginInstallButton').hidden", 5
        )
        out["topButtonShown"] = cdp.js("!document.getElementById('installButtonTop').hidden")
        cdp.js("document.getElementById('loginInstallButton').click(); true")
        out["promptedOnce"] = cdp.wait_for("window.__prompted === 1", 5)

        out["loggedIn"] = login(cdp)
        out["topButtonAfterLogin"] = cdp.js(
            "!document.getElementById('installButtonTop').hidden"
        )
        cdp.js("document.getElementById('installButtonTop').click(); true")
        out["helpOpened"] = cdp.wait_for(
            "!document.getElementById('viewAlerts').hidden", 5
        )
        out["helpHint"] = cdp.js("document.getElementById('installHint').textContent")
        out["qrInCard"] = cdp.js(
            "Boolean(document.querySelector('#viewAlerts img[src*=\"staff-install-qr\"]'))"
        )
        out["errors"] = cdp.js("JSON.stringify(window.__errors || [])")
    finally:
        stop(proc)

    # 2. iPhone Safari: no install event, Share instructions everywhere.
    cdp, proc = run_scenario(9359, user_agent=IPHONE_UA)
    try:
        out["iosHint"] = cdp.js("document.getElementById('loginInstallHint').textContent")
        out["iosTopButton"] = cdp.js(
            "!document.getElementById('installButtonTop').hidden"
        )
        out["iosLoggedIn"] = login(cdp)
        cdp.js("document.getElementById('installButtonTop').click(); true")
        out["iosHelpOpened"] = cdp.wait_for(
            "!document.getElementById('viewAlerts').hidden", 5
        )
        out["iosHelpHint"] = cdp.js("document.getElementById('installHint').textContent")
        cdp.shot(os.path.join(OUT, "staff-install-iphone-390.png"))
    finally:
        stop(proc)

    # 3. Already installed: no prompts, a confirmation instead.
    standalone = """
      (function () {
        var real = window.matchMedia.bind(window);
        window.matchMedia = function (query) {
          if (String(query).indexOf('display-mode: standalone') !== -1) {
            return {
              matches: true, media: String(query), onchange: null,
              addEventListener: function () {}, removeEventListener: function () {},
              addListener: function () {}, removeListener: function () {},
              dispatchEvent: function () { return false; }
            };
          }
          return real(query);
        };
        window.navigator.standalone = true;
      })();
    """
    cdp, proc = run_scenario(9360, setup_script=standalone)
    try:
        out["standaloneLoginCard"] = cdp.js(
            "document.getElementById('loginInstallCard').hidden"
        )
        out["standaloneLoggedIn"] = login(cdp)
        out["standaloneTopButton"] = cdp.js(
            "document.getElementById('installButtonTop').hidden"
        )
        cdp.js("document.querySelector('[data-tab=\"alerts\"]').click(); true")
        cdp.wait_for("!document.getElementById('viewAlerts').hidden", 5)
        out["standaloneHint"] = cdp.js("document.getElementById('installHint').textContent")
        out["standaloneQr"] = cdp.js("document.getElementById('installQr').hidden")
        out["standaloneInstallButton"] = cdp.js(
            "document.getElementById('installButton').hidden"
        )
        cdp.shot(os.path.join(OUT, "staff-install-standalone-390.png"))
    finally:
        stop(proc)

    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
