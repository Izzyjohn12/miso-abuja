/* MISO staff console — passcode login, live order queue and status actions. */

(function () {
  "use strict";

  var POLL_MS = 15000;
  var SEEN_KEY = "miso-staff-seen-v1";
  var SOUND_KEY = "miso-staff-sound-v1";

  var STATUS_LABEL = {
    new: "New",
    preparing: "Preparing",
    ready: "Ready",
    completed: "Completed",
    cancelled: "Cancelled"
  };
  var PAYMENT_LABEL = {
    unpaid: "Unpaid",
    paid: "Paid",
    pay_later: "Pay later"
  };
  var ACTIVE = ["new", "preparing", "ready"];

  var TIME = new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos"
  });
  var DATE = new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "short", timeZone: "Africa/Lagos"
  });
  var DAY = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Lagos"
  });

  var state = {
    orders: [],
    filter: "active",
    seen: readSeen(),
    primed: false,
    sound: window.localStorage.getItem(SOUND_KEY) !== "off",
    poll: null,
    loading: false,
    audio: null
  };

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(value) {
    return "\u20a6" + Math.round(Number(value) || 0).toLocaleString("en-NG");
  }

  function readSeen() {
    try {
      var raw = window.localStorage.getItem(SEEN_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeSeen() {
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen));
    } catch (err) {
      /* ignore */
    }
  }

  function request(path, options) {
    var opts = options || {};
    var headers = opts.headers || {};
    headers["X-MISO-CSRF"] = "1";
    if (opts.body) headers["Content-Type"] = "application/json";

    return fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { status: response.status, ok: response.ok, data: data };
      });
    });
  }

  /* ------------------------------------------------------------ login -- */

  function loginError(message) {
    var el = $("#loginError");
    var input = $("#passcode");
    el.hidden = false;
    el.textContent = message;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }

  function clearLoginError() {
    var el = $("#loginError");
    el.hidden = true;
    el.textContent = "";
    $("#passcode").removeAttribute("aria-invalid");
  }

  function showLogin(message) {
    stopPolling();
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    updateBadge(0);
    if (message) loginError(message);
    else clearLoginError();
    window.setTimeout(function () { $("#passcode").focus(); }, 60);
  }

  function enterApp() {
    clearLoginError();
    $("#passcode").value = "";
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    state.primed = false;
    unlockAudio();
    loadOrders(true).then(startPolling);
  }

  function initLogin() {
    $("#loginForm").addEventListener("submit", function (event) {
      event.preventDefault();
      clearLoginError();

      var input = $("#passcode");
      var passcode = input.value.trim().toUpperCase();
      if (!passcode) {
        loginError("Enter the staff passcode.");
        return;
      }

      var button = $("#loginButton");
      button.disabled = true;
      button.textContent = "Checking\u2026";

      request("/api/auth/login", { method: "POST", body: { passcode: passcode } })
        .then(function (result) {
          button.disabled = false;
          button.textContent = "Open the console";

          if (result.ok) {
            enterApp();
            return;
          }
          if (result.status === 401) {
            loginError("That passcode is not right. Try again.");
          } else if (result.status === 429) {
            loginError("Too many attempts. Wait 15 minutes, then try again.");
          } else if (result.status === 503) {
            loginError("Login is not set up yet. Ask the owner to set the staff passcode.");
          } else {
            loginError("Couldn't sign in. Try again.");
          }
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = "Open the console";
          loginError("Couldn't reach the server. Check the connection and try again.");
        });
    });

    $("#passcode").addEventListener("input", clearLoginError);

    $("#togglePasscode").addEventListener("click", function () {
      var input = $("#passcode");
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      this.textContent = showing ? "Show" : "Hide";
      this.setAttribute("aria-pressed", String(!showing));
    });

    $("#logoutButton").addEventListener("click", function () {
      var button = this;
      button.disabled = true;
      request("/api/auth/logout", { method: "POST" })
        .catch(function () { return null; })
        .then(function () {
          button.disabled = false;
          state.orders = [];
          state.primed = false;
          showLogin();
        });
    });

    request("/api/auth/session")
      .then(function (result) {
        if (result.ok && result.data.authenticated) enterApp();
        else showLogin();
      })
      .catch(function () {
        showLogin("Couldn't reach the server. Check the connection and try again.");
      });
  }

  /* ----------------------------------------------------------- queue -- */

  function loadOrders(quiet) {
    if (state.loading) return Promise.resolve();
    state.loading = true;

    return request("/api/orders?status=all")
      .then(function (result) {
        state.loading = false;
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          setLive(false);
          if (!quiet) toast("Couldn't refresh the queue.", true);
          return;
        }
        applyOrders(result.data.orders || []);
      })
      .catch(function () {
        state.loading = false;
        setLive(false);
        if (!quiet) toast("Couldn't reach the server.", true);
      });
  }

  function applyOrders(orders) {
    var newOrders = orders.filter(function (order) { return order.status === "new"; });
    var fresh = newOrders.filter(function (order) { return !state.seen[order.id]; });

    state.orders = orders;

    var live = {};
    orders.forEach(function (order) {
      if (state.seen[order.id]) live[order.id] = 1;
    });
    newOrders.forEach(function (order) { live[order.id] = 1; });
    state.seen = live;
    writeSeen();

    if (state.primed && fresh.length) {
      chime();
      toast(
        fresh.length === 1
          ? "New order \u2014 " + fresh[0].ref
          : fresh.length + " new orders"
      );
    }
    state.primed = true;

    render();
    setLive(true);
    $("#updatedAt").textContent = "Updated " + TIME.format(new Date());
    updateBadge(newOrders.length);
  }

  function filteredOrders() {
    if (state.filter === "cancelled") {
      return state.orders.filter(function (order) { return order.status === "cancelled"; });
    }
    if (state.filter === "all") return state.orders;
    return state.orders.filter(function (order) {
      return ACTIVE.indexOf(order.status) !== -1;
    });
  }

  function render() {
    var orders = filteredOrders();
    var counts = {
      active: 0,
      new: 0,
      kitchen: 0,
      today: 0,
      all: state.orders.length,
      cancelled: 0
    };
    var today = DAY.format(new Date());

    state.orders.forEach(function (order) {
      if (ACTIVE.indexOf(order.status) !== -1) counts.active += 1;
      if (order.status === "new") counts.new += 1;
      if (order.status === "preparing" || order.status === "ready") counts.kitchen += 1;
      if (order.status === "cancelled") counts.cancelled += 1;
      if (DAY.format(new Date(order.placedAt)) === today) counts.today += 1;
    });

    $("#newCount").textContent = String(counts.new);
    $("#activeCount").textContent = String(counts.kitchen);
    $("#todayCount").textContent = String(counts.today);
    $("#filterActive").textContent = String(counts.active);
    $("#filterAll").textContent = String(counts.all);
    $("#filterCancelled").textContent = String(counts.cancelled);

    $$(".filter").forEach(function (button) {
      button.classList.toggle(
        "is-active",
        button.getAttribute("data-filter") === state.filter
      );
    });

    $("#orders").innerHTML = orders.map(orderCard).join("");
    $("#empty").hidden = orders.length > 0;

    if (state.filter === "cancelled") {
      $("#emptyTitle").textContent = "No cancelled orders";
      $("#emptyText").textContent = "Cancelled orders stay here for reference.";
    } else if (state.filter === "all") {
      $("#emptyTitle").textContent = "No orders yet";
      $("#emptyText").textContent = "The first order from the website will appear here.";
    } else {
      $("#emptyTitle").textContent = "No active orders";
      $("#emptyText").textContent = "New orders from the website will appear here automatically.";
    }
  }

  function orderCard(order) {
    var status = escapeHtml(order.status);
    var payment = escapeHtml(order.paymentStatus);
    var guest = "";

    if (order.service !== "dine-in" && (order.customerName || order.customerPhone)) {
      var phone = String(order.customerPhone || "");
      var digits = phone.replace(/\D/g, "");
      var wa = digits.charAt(0) === "0" ? "234" + digits.slice(1) : digits;
      guest =
        '<p class="order__guest"><strong>' + escapeHtml(order.customerName || "Guest") + "</strong>" +
        (digits
          ? '<a href="tel:' + escapeHtml(digits) + '">' + escapeHtml(phone) + "</a>" +
            '<a href="https://wa.me/' + escapeHtml(wa) + '" target="_blank" rel="noopener">WhatsApp</a>'
          : "") +
        "</p>";
    }

    var items = (order.items || []).map(function (item) {
      return (
        "<li>" +
        '<span class="qty">' + item.qty + "\u00d7</span>" +
        '<span class="dish"><strong>' + escapeHtml(item.name) + "</strong>" +
        (item.note ? "<em>" + escapeHtml(item.note) + "</em>" : "") +
        "</span>" +
        '<span class="line">' + money(item.lineTotal) + "</span>" +
        "</li>"
      );
    }).join("");

    var totals =
      '<div class="order__totals">' +
      '<div><span>Subtotal</span><span>' + money(order.subtotal) + "</span></div>" +
      "<div><span>Tax (" + Math.round((order.taxRate || 0) * 100) + "%)</span><span>" +
        money(order.tax) + "</span></div>" +
      (order.feePending
        ? '<div><span>Delivery</span><span>Bolt quote</span></div>'
        : order.fee
          ? '<div><span>Delivery</span><span>' + money(order.fee) + "</span></div>"
          : "") +
      '<div class="total"><span>' +
        (order.service === "dine-in" ? "Amount due" : "Total") +
        "</span><strong>" + money(order.total) + "</strong></div>" +
      "</div>";

    var actions = [];
    if (order.status === "new") {
      actions.push(actionButton(order, "preparing", "Start preparing", "btn"));
    } else if (order.status === "preparing") {
      actions.push(actionButton(order, "ready", "Mark ready", "btn"));
    } else if (order.status === "ready") {
      actions.push(actionButton(order, "completed", "Complete", "btn"));
    }
    if (ACTIVE.indexOf(order.status) !== -1) {
      actions.push(actionButton(order, "cancelled", "Cancel", "btn btn--danger"));
    }
    if (order.paymentStatus !== "paid" && order.status !== "cancelled") {
      actions.push(
        '<button class="btn btn--ghost" type="button" data-act="paid" data-id="' +
          escapeHtml(order.id) + '">Mark paid</button>'
      );
    }

    return (
      '<article class="order order--' + status + '">' +
        '<header class="order__head">' +
          "<div>" +
            '<p class="order__ref">' + escapeHtml(order.ref) + "</p>" +
            '<p class="order__time">' + escapeHtml(orderTime(order.placedAt)) + "</p>" +
          "</div>" +
          '<div class="chips">' +
            '<span class="chip chip--' + status + '">' + STATUS_LABEL[order.status] + "</span>" +
            '<span class="chip chip--' + payment + '">' + PAYMENT_LABEL[order.paymentStatus] + "</span>" +
          "</div>" +
        "</header>" +
        '<p class="order__service">' + escapeHtml(order.serviceLabel || order.service) + "</p>" +
        (order.serviceDetail
          ? '<p class="order__detail">' + escapeHtml(order.serviceDetail) + "</p>"
          : "") +
        guest +
        '<ul class="order__items">' + items + "</ul>" +
        (order.notes
          ? '<p class="order__note">' + escapeHtml(order.notes) + "</p>"
          : "") +
        totals +
        (actions.length ? '<div class="order__actions">' + actions.join("") + "</div>" : "") +
      "</article>"
    );
  }

  function actionButton(order, status, label, className) {
    return (
      '<button class="' + className + '" type="button" data-act="status" data-status="' +
      status + '" data-id="' + escapeHtml(order.id) + '">' + label + "</button>"
    );
  }

  function orderTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var prefix = DAY.format(date) === DAY.format(new Date()) ? "" : DATE.format(date) + " \u00b7 ";
    return prefix + TIME.format(date);
  }

  function patchOrder(id, patch, successMessage) {
    request("/api/orders/" + encodeURIComponent(id), { method: "PATCH", body: patch })
      .then(function (result) {
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          toast(
            result.data && result.data.error === "bad_transition"
              ? "That step is no longer available. Refreshing\u2026"
              : "Couldn't update the order.",
            true
          );
          loadOrders(true);
          return;
        }
        toast(successMessage);
        loadOrders(true);
      })
      .catch(function () {
        toast("Couldn't reach the server.", true);
      });
  }

  function initQueue() {
    $("#orders").addEventListener("click", function (event) {
      var button = event.target.closest("[data-act]");
      if (!button || button.disabled) return;

      var id = button.getAttribute("data-id");
      var action = button.getAttribute("data-act");

      if (action === "paid") {
        button.disabled = true;
        patchOrder(id, { paymentStatus: "paid" }, "Payment marked paid");
        return;
      }

      var status = button.getAttribute("data-status");
      if (status === "cancelled" &&
          !window.confirm("Cancel this order? The guest still has their WhatsApp message.")) {
        return;
      }
      button.disabled = true;

      var message =
        status === "preparing" ? "Order moved to the kitchen"
        : status === "ready" ? "Order marked ready"
        : status === "completed" ? "Order completed"
        : "Order cancelled";
      patchOrder(id, { status: status }, message);
    });

    $$(".filter").forEach(function (button) {
      button.addEventListener("click", function () {
        state.filter = button.getAttribute("data-filter");
        render();
      });
    });

    $("#refreshButton").addEventListener("click", function () {
      loadOrders(false);
    });

    $("#soundButton").addEventListener("click", function () {
      state.sound = !state.sound;
      try {
        window.localStorage.setItem(SOUND_KEY, state.sound ? "on" : "off");
      } catch (err) {
        /* ignore */
      }
      syncSoundButton();
      if (state.sound) {
        unlockAudio();
        chime();
      }
    });

    syncSoundButton();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !$("#appView").hidden) loadOrders(true);
    });
    window.addEventListener("focus", function () {
      if (!$("#appView").hidden) loadOrders(true);
    });
    window.addEventListener("online", function () {
      if (!$("#appView").hidden) loadOrders(true);
    });
  }

  function startPolling() {
    stopPolling();
    if ($("#appView").hidden) return;
    state.poll = window.setInterval(function () {
      if (document.visibilityState === "visible" && !$("#appView").hidden) {
        loadOrders(true);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.poll) {
      window.clearInterval(state.poll);
      state.poll = null;
    }
  }

  function setLive(online) {
    $("#liveBadge").classList.toggle("is-offline", !online);
    $("#liveText").textContent = online ? "Live" : "Offline";
  }

  function updateBadge(count) {
    try {
      if (count > 0 && navigator.setAppBadge) navigator.setAppBadge(count);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (err) {
      /* not supported */
    }
  }

  /* ------------------------------------------------------------ sound -- */

  function unlockAudio() {
    if (!state.audio) {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      try {
        state.audio = new AudioCtor();
      } catch (err) {
        return;
      }
    }
    if (state.audio.state === "suspended") {
      state.audio.resume().catch(function () {});
    }
  }

  function chime() {
    if (!state.sound) return;
    unlockAudio();
    var ctx = state.audio;
    if (!ctx) return;

    var now = ctx.currentTime;
    [880, 1174.66].forEach(function (frequency, index) {
      var oscillator = ctx.createOscillator();
      var gain = ctx.createGain();
      var at = now + index * 0.18;

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.36);
    });
  }

  function syncSoundButton() {
    var button = $("#soundButton");
    button.classList.toggle("is-off", !state.sound);
    button.setAttribute("aria-pressed", String(state.sound));
    button.setAttribute("aria-label", state.sound ? "Turn alert sound off" : "Turn alert sound on");
    button.title = state.sound ? "Alert sound on" : "Alert sound off";
  }

  /* ------------------------------------------------------------ toast -- */

  var toastTimer = null;

  function toast(message, isError) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.toggle("toast--error", Boolean(isError));
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* ------------------------------------------------------------- boot -- */

  initLogin();
  initQueue();
})();
