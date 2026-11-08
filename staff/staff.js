/* MISO staff console — passcode login, live order queue, menu editor and
 * Web Push alerts. Plain IIFE: no build step, ES5 syntax. */

(function () {
  "use strict";

  var POLL_MS = 15000;
  var SEEN_KEY = "miso-staff-seen-v1";
  var SOUND_KEY = "miso-staff-sound-v1";
  var ALARM_CYCLE_MS = 6200;
  var ALARM_VIBRATE = [800, 300, 800, 300, 800, 300, 1200];
  var TABS = ["orders", "menu", "alerts"];
  var TAB_TITLE = {
    orders: "Order queue",
    menu: "Menu editor",
    alerts: "Alerts"
  };

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
  var TAG_LABEL = {
    spicy: "Spicy",
    veg: "Vegetarian",
    shellfish: "Shellfish"
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
    audio: null,
    alarmBuffer: null,
    alarmSource: null,
    alarmGain: null,
    alarmVibe: null,
    ringing: false,
    tab: "orders",
    menu: null,
    menuLoading: false,
    editingId: null,
    alerts: null,
    swPromise: null,
    installPrompt: null,
    installed: false
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
    stopAlarm();
    closeDishSheet();
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
    registerServiceWorker();
    setTab(readTab(), false);
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
          state.menu = null;
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

  /* ------------------------------------------------------- navigation -- */

  function readTab() {
    var hash = String(window.location.hash || "").replace("#", "").split("?")[0];
    return TABS.indexOf(hash) === -1 ? "orders" : hash;
  }

  function setTab(tab, writeHash) {
    if (TABS.indexOf(tab) === -1) tab = "orders";
    state.tab = tab;

    TABS.forEach(function (name) {
      var view = $("#view" + name.charAt(0).toUpperCase() + name.slice(1));
      if (view) view.hidden = name !== tab;
    });

    $$(".tab").forEach(function (button) {
      var isActive = button.getAttribute("data-tab") === tab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    $("#topbarTitle").textContent = TAB_TITLE[tab];
    document.title = "MISO Staff \u2014 " + TAB_TITLE[tab];
    $("#refreshButton").title = "Refresh " + TAB_TITLE[tab].toLowerCase();
    $("#refreshButton").setAttribute("aria-label", "Refresh " + TAB_TITLE[tab].toLowerCase());

    if (writeHash !== false) {
      try {
        window.history.replaceState(null, "", "#" + tab);
      } catch (err) {
        /* ignore */
      }
    }

    if (tab === "menu") loadMenu(false);
    if (tab === "alerts") refreshAlerts(false);
  }

  function initNav() {
    $$(".tab").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.getAttribute("data-tab"), true);
      });
    });

    window.addEventListener("hashchange", function () {
      if (!$("#appView").hidden) setTab(readTab(), false);
    });

    $("#refreshButton").addEventListener("click", function () {
      if (state.tab === "menu") loadMenu(true);
      else if (state.tab === "alerts") refreshAlerts(true);
      else loadOrders(false);
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
    updateTabCount(newOrders.length);
    syncAlarm(newOrders.length);
  }

  function updateTabCount(count) {
    var badge = $("#ordersTabCount");
    badge.hidden = count === 0;
    badge.textContent = String(count);
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

  function alertNote(order) {
    if (order.notifiedAt || !order.notifyError) return "";

    var message;
    var action = "";
    if (order.notifyError === "push_not_configured") {
      message = "Push alerts are not configured on the server.";
    } else if (order.notifyError === "no_subscribers") {
      message = "No phone is subscribed to alerts yet.";
      action = '<button class="dish-btn" type="button" data-act="open-alerts">Set up alerts</button>';
    } else {
      message = "The alert did not reach a phone.";
      action = '<button class="dish-btn" type="button" data-act="alert" data-id="' +
        escapeHtml(order.id) + '">Retry alert</button>';
    }

    return '<p class="order__alert"><span>' + escapeHtml(message) + "</span>" + action + "</p>";
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
        alertNote(order) +
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

  function retryAlert(id) {
    request("/api/orders/" + encodeURIComponent(id), {
      method: "PATCH",
      body: { retryAlert: true }
    })
      .then(function (result) {
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          toast("Couldn't send the alert. Try again.", true);
          loadOrders(true);
          return;
        }
        var sent = Number(result.data.alert && result.data.alert.sent) || 0;
        if (sent) {
          toast(sent === 1 ? "Alert sent to 1 phone" : "Alert sent to " + sent + " phones");
        } else {
          toast("No phone received the alert. Check the Alerts tab.", true);
        }
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

      if (action === "open-alerts") {
        setTab("alerts", true);
        return;
      }

      if (action === "alert") {
        button.disabled = true;
        retryAlert(id);
        return;
      }

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
        if (state.ringing) startAlarmAudio();
      } else {
        stopAlarmAudio();
      }
    });

    $("#alarmGo").addEventListener("click", function () {
      setTab("orders", true);
      var first = $(".order--new");
      if (first && first.scrollIntoView) {
        first.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });

    syncSoundButton();

    document.addEventListener("click", function () {
      if (state.sound) unlockAudio();
    }, { passive: true });

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

  /* ------------------------------------------------------------ menu -- */

  function loadMenu(force) {
    if (state.menuLoading) return Promise.resolve();
    if (state.menu && !force) return Promise.resolve();

    state.menuLoading = true;
    $("#menuError").hidden = true;
    if (!state.menu) $("#menuTotal").textContent = "Loading menu\u2026";

    return request("/api/menu/items")
      .then(function (result) {
        state.menuLoading = false;
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          $("#menuError").hidden = false;
          $("#menuError").textContent = "Couldn't load the menu. Check the connection and try again.";
          return;
        }
        state.menu = result.data;
        buildGroupOptions();
        renderMenu();
      })
      .catch(function () {
        state.menuLoading = false;
        $("#menuError").hidden = false;
        $("#menuError").textContent = "Couldn't reach the server.";
      });
  }

  function buildGroupOptions() {
    var select = $("#dishGroup");
    if (!select || !state.menu) return;

    var html = "";
    (state.menu.categories || []).forEach(function (category) {
      var groups = (category.groups || []).filter(function (group) {
        return (group.items || []).length > 0;
      });
      if (!groups.length) return;
      html += '<optgroup label="' + escapeHtml(category.name) + '">';
      groups.forEach(function (group) {
        html += '<option value="' + escapeHtml(group.id) + '">' +
          escapeHtml(group.name) + "</option>";
      });
      html += "</optgroup>";
    });

    select.innerHTML = html;
  }

  function findMenuItem(id) {
    if (!state.menu) return null;
    var found = null;
    (state.menu.categories || []).forEach(function (category) {
      (category.groups || []).forEach(function (group) {
        (group.items || []).forEach(function (item) {
          if (item.id === id) found = item;
        });
      });
    });
    return found;
  }

  function renderMenu() {
    if (!state.menu) return;

    var query = $("#menuSearch").value.trim().toLowerCase();
    var shown = 0;
    var hiddenShown = 0;
    var categoriesHtml = "";

    (state.menu.categories || []).forEach(function (category) {
      var groupsHtml = "";
      var categoryCount = 0;
      var categoryHidden = 0;

      (category.groups || []).forEach(function (group) {
        var items = (group.items || []).filter(function (item) {
          if (!query) return true;
          var haystack = [
            item.name,
            item.description || "",
            category.name,
            group.name,
            (item.tags || []).join(" ")
          ].join(" ").toLowerCase();
          return haystack.indexOf(query) !== -1;
        });

        if (!items.length) return;

        categoryCount += items.length;
        categoryHidden += items.filter(function (item) { return item.hidden; }).length;

        groupsHtml +=
          '<section class="menu-group">' +
            "<h4>" + escapeHtml(group.name) + "</h4>" +
            '<ul class="dish-list">' + items.map(dishRow).join("") + "</ul>" +
          "</section>";
      });

      if (!groupsHtml) return;
      shown += categoryCount;
      hiddenShown += categoryHidden;

      var meta = categoryCount + (categoryCount === 1 ? " dish" : " dishes");
      if (categoryHidden) meta += " \u00b7 " + categoryHidden + " hidden";

      categoriesHtml +=
        '<details class="menu-cat" open>' +
          '<summary class="menu-cat__head">' +
            '<span class="menu-cat__name">' + escapeHtml(category.name) + "</span>" +
            '<span class="menu-cat__meta">' + escapeHtml(meta) + "</span>" +
            '<svg class="menu-cat__chevron" viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M12 15.4 5.6 9 4.2 10.4 12 18.2l7.8-7.8L18.4 9z"/></svg>' +
          "</summary>" +
          '<div class="menu-cat__body">' + groupsHtml + "</div>" +
        "</details>";
    });

    $("#menuList").innerHTML = categoriesHtml;
    $("#menuEmpty").hidden = shown > 0;

    if (query) {
      $("#menuTotal").textContent = shown + (shown === 1 ? " match" : " matches");
    } else {
      var total = Number(state.menu.itemCount) || 0;
      var hidden = Number(state.menu.hiddenCount) || 0;
      $("#menuTotal").textContent = total + (total === 1 ? " dish" : " dishes") +
        (hidden ? " \u00b7 " + hidden + " hidden" : "");
    }
  }

  function dishRow(item) {
    var tags = (item.tags || []).map(function (tag) {
      return TAG_LABEL[tag] || tag;
    }).join(", ");

    var meta = item.price === null ? "Price on request" : money(item.price);
    if (tags) meta += " \u00b7 " + tags;

    return (
      '<li class="dish-row' + (item.hidden ? " is-hidden" : "") + '">' +
        '<div class="dish-row__main">' +
          '<p class="dish-row__name">' + escapeHtml(item.name) +
            (item.hidden ? '<span class="chip chip--hidden">Hidden</span>' : "") +
          "</p>" +
          '<p class="dish-row__meta">' + escapeHtml(meta) + "</p>" +
          (item.description
            ? '<p class="dish-row__desc">' + escapeHtml(item.description) + "</p>"
            : "") +
        "</div>" +
        '<div class="dish-row__actions">' +
          '<button class="dish-btn" type="button" data-menu-act="edit" data-id="' +
            escapeHtml(item.id) + '">Edit</button>' +
          '<button class="dish-btn' + (item.hidden ? " dish-btn--show" : "") +
            '" type="button" data-menu-act="' + (item.hidden ? "show" : "hide") +
            '" data-id="' + escapeHtml(item.id) + '">' +
            (item.hidden ? "Show" : "Hide") +
          "</button>" +
        "</div>" +
      "</li>"
    );
  }

  function setDishHidden(id, hidden) {
    request("/api/menu/items/" + encodeURIComponent(id), {
      method: "PATCH",
      body: { hidden: hidden }
    })
      .then(function (result) {
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          toast("Couldn't update that dish. Try again.", true);
          loadMenu(true);
          return;
        }
        toast(hidden ? "Dish hidden from the guest menu" : "Dish is back on the guest menu");
        loadMenu(true);
      })
      .catch(function () {
        toast("Couldn't reach the server.", true);
      });
  }

  function initMenu() {
    $("#menuSearch").addEventListener("input", renderMenu);

    $("#menuList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-menu-act]");
      if (!button || button.disabled) return;

      var id = button.getAttribute("data-id");
      var action = button.getAttribute("data-menu-act");
      var item = findMenuItem(id);
      if (!item) return;

      if (action === "edit") {
        openDishSheet(item);
        return;
      }

      var hiding = action === "hide";
      if (hiding && !window.confirm(
        "Hide \u201c" + item.name + "\u201d from the guest menu? Past orders keep it."
      )) {
        return;
      }

      button.disabled = true;
      setDishHidden(id, hiding);
    });

    $("#addDishButton").addEventListener("click", function () {
      if (!state.menu) {
        loadMenu(true).then(function () { openDishSheet(null); });
        return;
      }
      openDishSheet(null);
    });

    $$("[data-close-sheet]").forEach(function (button) {
      button.addEventListener("click", closeDishSheet);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !$("#dishSheet").hidden) closeDishSheet();
    });

    $("#dishRequest").addEventListener("change", function () {
      $("#dishPrice").disabled = this.checked;
      if (this.checked) $("#dishPrice").value = "";
    });

    $("#dishForm").addEventListener("submit", saveDish);
  }

  function dishError(message) {
    var el = $("#dishError");
    el.hidden = false;
    el.textContent = message;
    el.scrollIntoView({ block: "nearest" });
  }

  function clearDishError() {
    $("#dishError").hidden = true;
    $("#dishError").textContent = "";
  }

  function openDishSheet(item) {
    if (!state.menu) return;

    state.editingId = item ? item.id : null;

    $("#dishSheetKicker").textContent = item ? "Edit dish" : "New dish";
    $("#dishSheetTitle").textContent = item ? item.name : "Add a dish";
    $("#dishId").value = item ? item.id : "";
    $("#dishName").value = item ? item.name : "";

    var firstOption = $("#dishGroup").querySelector("option");
    $("#dishGroup").value = item ? item.groupId : (firstOption ? firstOption.value : "");

    var onRequest = item ? item.price === null : false;
    $("#dishRequest").checked = onRequest;
    $("#dishPrice").value = item && item.price !== null ? String(item.price) : "";
    $("#dishPrice").disabled = onRequest;

    $("#dishDescription").value = item ? item.description || "" : "";

    $$('input[name="dishTag"]').forEach(function (box) {
      box.checked = Boolean(item && (item.tags || []).indexOf(box.value) !== -1);
    });

    clearDishError();
    $("#dishSheet").hidden = false;
    document.body.classList.add("has-sheet");
    window.setTimeout(function () { $("#dishName").focus(); }, 80);
  }

  function closeDishSheet() {
    var sheet = $("#dishSheet");
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    state.editingId = null;
    document.body.classList.remove("has-sheet");
  }

  function menuErrorMessage(error) {
    switch (error) {
      case "name_required":
        return "Give the dish a name.";
      case "bad_group":
        return "That category group is no longer available. Refresh the menu and try again.";
      case "bad_price":
        return "Enter a whole naira price up to \u20a610,000,000.";
      case "bad_tags":
        return "One of those tags is not recognised.";
      case "not_found":
        return "That dish no longer exists. Refresh the menu.";
      case "nothing_to_update":
        return "Change something before saving.";
      default:
        return "Couldn't save the dish. Check the details and try again.";
    }
  }

  function saveDish(event) {
    event.preventDefault();
    clearDishError();

    var name = $("#dishName").value.trim();
    var groupId = $("#dishGroup").value;
    var onRequest = $("#dishRequest").checked;
    var priceRaw = $("#dishPrice").value.trim();
    var price = null;

    if (name.length < 2) {
      dishError("Give the dish a name.");
      return;
    }
    if (!groupId) {
      dishError("Choose a category and group.");
      return;
    }
    if (!onRequest) {
      if (!priceRaw) {
        dishError("Enter a price, or tick Price on request.");
        return;
      }
      price = Number(priceRaw);
      if (!Number.isInteger(price) || price < 0 || price > 10000000) {
        dishError("Enter a whole naira price up to \u20a610,000,000.");
        return;
      }
    }

    var tags = $$('input[name="dishTag"]:checked').map(function (box) {
      return box.value;
    });

    var payload = {
      name: name,
      groupId: groupId,
      description: $("#dishDescription").value.trim(),
      priceOnRequest: onRequest,
      tags: tags
    };
    if (!onRequest) payload.price = price;

    var editing = state.editingId;
    var path = editing
      ? "/api/menu/items/" + encodeURIComponent(editing)
      : "/api/menu/items";
    var button = $("#dishSave");
    button.disabled = true;
    button.textContent = "Saving\u2026";

    request(path, { method: editing ? "PATCH" : "POST", body: payload })
      .then(function (result) {
        button.disabled = false;
        button.textContent = "Save dish";

        if (result.status === 401) {
          closeDishSheet();
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (!result.ok) {
          dishError(menuErrorMessage(result.data && result.data.error));
          return;
        }

        closeDishSheet();
        toast(editing ? "Dish updated" : "Dish added to the menu");
        loadMenu(true);
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Save dish";
        dishError("Couldn't reach the server. Try again.");
      });
  }

  /* ----------------------------------------------------------- alerts -- */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    if (state.swPromise) return state.swPromise;
    state.swPromise = navigator.serviceWorker.register("/sw.js")
      .catch(function () { return null; });
    return state.swPromise;
  }

  function pushRegistration() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return Promise.resolve(null);
    }
    return registerServiceWorker().then(function (registration) {
      return registration || navigator.serviceWorker.ready;
    }).catch(function () {
      return null;
    });
  }

  function localPushState() {
    var supported = "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supported) {
      return Promise.resolve({ supported: false, subscribed: false, permission: "unsupported" });
    }

    return pushRegistration().then(function (registration) {
      if (!registration) {
        return { supported: true, subscribed: false, permission: Notification.permission, ready: false };
      }
      return registration.pushManager.getSubscription().then(function (subscription) {
        return {
          supported: true,
          subscribed: Boolean(subscription),
          permission: Notification.permission,
          ready: true
        };
      });
    }).catch(function () {
      return { supported: true, subscribed: false, permission: Notification.permission, ready: false };
    });
  }

  function refreshAlerts(userInitiated) {
    if ($("#appView").hidden) return Promise.resolve();

    $("#alertDeviceStatus").textContent = "Checking this phone\u2026";

    var configTask = request("/api/alerts/config")
      .then(function (result) {
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return null;
        }
        if (!result.ok) return null;
        state.alerts = result.data;
        return result.data;
      })
      .catch(function () { return null; });

    return Promise.all([configTask, localPushState()]).then(function (values) {
      renderAlerts(values[0], values[1]);
      if (userInitiated) {
        toast(values[0] ? "Alert status refreshed" : "Couldn't read alert settings.", !values[0]);
      }
    });
  }

  function renderAlerts(config, local) {
    var head = $("#alertDeviceStatus").closest(".alert-card__head");
    var status;
    var offline = false;

    if (!local.supported) {
      status = "Push alerts are not supported in this browser.";
      offline = true;
    } else if (local.permission === "denied") {
      status = "Notifications are blocked for this site. Allow them in browser settings.";
      offline = true;
    } else if (local.subscribed && config && config.configured) {
      status = "Alerts are on for this phone.";
    } else if (local.subscribed && !config) {
      status = "This phone is subscribed, but the server status is unavailable.";
      offline = true;
    } else if (local.subscribed) {
      status = "This phone is subscribed, but the server has no push keys.";
      offline = true;
    } else {
      status = "Alerts are off for this phone.";
      offline = true;
    }

    $("#alertDeviceStatus").textContent = status;
    head.classList.toggle("is-off", offline);

    var canEnable = local.supported &&
      !local.subscribed &&
      local.permission !== "denied" &&
      Boolean(config && config.configured);

    $("#enablePushButton").hidden = !canEnable;
    $("#disablePushButton").hidden = !local.subscribed;
    $("#testPushButton").hidden = !(local.subscribed && config && config.configured);

    var permissionLabel = {
      granted: "Allowed",
      denied: "Blocked",
      "default": "Not asked yet",
      unsupported: "Unsupported"
    }[local.permission] || "Unknown";

    var meta = "Browser permission: " + permissionLabel + ".";
    if (config && !config.configured) {
      meta = "The server has no push keys yet. Ask the owner to set them.";
    }
    $("#alertPermission").textContent = meta;

    $("#alertDeviceCount").textContent = config
      ? config.deviceCount + (config.deviceCount === 1 ? " phone" : " phones")
      : "\u2014";

    $("#alertLastDelivery").textContent = config
      ? (config.lastSuccessAt
        ? "Last delivery " + orderTime(config.lastSuccessAt)
        : "No alert delivered yet.")
      : "Couldn't read delivery status.";
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = new Array(((4 - base64String.length % 4) % 4) + 1).join("=");
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function enablePush() {
    if (!state.alerts || !state.alerts.configured || !state.alerts.publicKey) {
      toast("Push alerts are not configured on the server.", true);
      return;
    }

    var button = $("#enablePushButton");
    button.disabled = true;
    button.textContent = "Enabling\u2026";

    window.Notification.requestPermission()
      .then(function (permission) {
        if (permission !== "granted") {
          toast(
            permission === "denied"
              ? "Notifications are blocked. Allow them in browser settings."
              : "Notifications were not allowed.",
            true
          );
          return null;
        }

        return pushRegistration().then(function (registration) {
          if (!registration) throw new Error("no_registration");
          return registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(state.alerts.publicKey)
          });
        }).then(function (subscription) {
          var json = subscription.toJSON();
          return request("/api/alerts/subscribe", {
            method: "POST",
            body: { endpoint: json.endpoint, keys: json.keys }
          }).then(function (result) {
            if (result.status === 401) {
              showLogin("Your session ended. Sign in again.");
              return;
            }
            if (!result.ok) {
              return subscription.unsubscribe().catch(function () {}).then(function () {
                throw new Error("subscribe_failed");
              });
            }
            toast("Alerts are on for this phone");
          });
        });
      })
      .catch(function (err) {
        toast(
          err && err.message === "subscribe_failed"
            ? "Couldn't save this phone. Try again."
            : "Couldn't turn on alerts on this phone.",
          true
        );
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Enable alerts";
        refreshAlerts(false);
      });
  }

  function disablePush() {
    var button = $("#disablePushButton");
    button.disabled = true;

    pushRegistration()
      .then(function (registration) {
        if (!registration) return null;
        return registration.pushManager.getSubscription();
      })
      .then(function (subscription) {
        if (!subscription) return null;
        var endpoint = subscription.endpoint;
        return subscription.unsubscribe().then(function () {
          return request("/api/alerts/subscribe", {
            method: "DELETE",
            body: { endpoint: endpoint }
          });
        }).then(function (result) {
          if (result.status === 401) {
            showLogin("Your session ended. Sign in again.");
            return;
          }
          toast("Alerts are off for this phone");
        });
      })
      .catch(function () {
        toast("Couldn't turn off alerts. Try again.", true);
      })
      .then(function () {
        button.disabled = false;
        refreshAlerts(false);
      });
  }

  function sendTestAlert() {
    var button = $("#testPushButton");
    button.disabled = true;
    button.textContent = "Sending\u2026";

    request("/api/alerts/test", { method: "POST" })
      .then(function (result) {
        if (result.status === 401) {
          showLogin("Your session ended. Sign in again.");
          return;
        }
        if (result.status === 503) {
          toast("Push is not configured on the server.", true);
          return;
        }
        if (!result.ok) {
          toast("The test alert couldn't be sent.", true);
          return;
        }
        var alert = result.data.result || {};
        var sent = Number(alert.sent) || 0;
        if (sent) {
          toast(sent === 1 ? "Test alert sent to 1 phone" : "Test alert sent to " + sent + " phones");
        } else if (Number(alert.attempted) === 0) {
          toast("No phone is subscribed yet. Enable alerts on a phone first.", true);
        } else {
          toast("The test alert didn't reach a phone.", true);
        }
        refreshAlerts(false);
      })
      .catch(function () {
        toast("Couldn't reach the server.", true);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Send test alert";
      });
  }

  function initAlerts() {
    $("#enablePushButton").addEventListener("click", enablePush);
    $("#disablePushButton").addEventListener("click", disablePush);
    $("#testPushButton").addEventListener("click", sendTestAlert);
    $("#refreshAlertsButton").addEventListener("click", function () {
      refreshAlerts(true);
    });

    $("#logoutAllButton").addEventListener("click", function () {
      if (!window.confirm("Sign out every phone, including this one?")) return;
      var button = this;
      button.disabled = true;
      request("/api/auth/logout", { method: "POST", body: { all: true } })
        .catch(function () { return null; })
        .then(function () {
          button.disabled = false;
          state.orders = [];
          state.menu = null;
          state.primed = false;
          showLogin("All devices signed out.");
        });
    });
  }

  /* ---------------------------------------------------------- install -- */

  function isStandalone() {
    return (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function installCopy() {
    if (state.installed || isStandalone()) {
      return {
        installed: true,
        login: "MISO Staff is installed. Open it from the home screen.",
        alert: "Running as the installed app. Push alerts work best here."
      };
    }
    if (isIos()) {
      return {
        installed: false,
        login: "On iPhone: tap Share, then Add to Home Screen. iOS 16.4+ only sends push to the installed app.",
        alert: "Tap Share at the bottom of Safari, then Add to Home Screen. Open MISO Staff from the new icon before enabling alerts."
      };
    }
    return {
      installed: false,
      login: "Install MISO Staff to open the queue full screen and keep alerts working.",
      alert: "Use the install button, or open the browser menu and choose Install app."
    };
  }

  function syncInstallButtons() {
    var copy = installCopy();
    var show = !copy.installed;

    $("#installButtonTop").hidden = !show;
    $("#loginInstallCard").hidden = !show;
    $("#installQr").hidden = !show;
    $("#loginInstallButton").hidden = !(show && state.installPrompt);
    $("#installButton").hidden = !(show && state.installPrompt);
    $("#loginInstallHint").textContent = copy.login;
    $("#installHint").textContent = copy.alert;
  }

  function openInstallHelp() {
    setTab("alerts", true);
    var card = $("#installCard");
    if (card && card.scrollIntoView) {
      card.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function install() {
    if (!state.installPrompt) {
      openInstallHelp();
      return;
    }

    var prompt = state.installPrompt;
    prompt.prompt();
    prompt.userChoice.then(function (choice) {
      if (choice && choice.outcome === "accepted") {
        state.installPrompt = null;
        toast("Installing MISO Staff\u2026");
      }
      syncInstallButtons();
    }).catch(function () {
      syncInstallButtons();
    });
  }

  function initInstall() {
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      state.installPrompt = event;
      syncInstallButtons();
    });

    window.addEventListener("appinstalled", function () {
      state.installed = true;
      state.installPrompt = null;
      syncInstallButtons();
      toast("MISO Staff installed");
    });

    $("#installButton").addEventListener("click", install);
    $("#loginInstallButton").addEventListener("click", install);
    $("#installButtonTop").addEventListener("click", install);

    syncInstallButtons();
  }

  /* -------------------------------------------------- alarm + vibration -- */

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (err) {
      /* unsupported or blocked */
    }
  }

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
      state.audio.resume().then(function () {
        if (state.ringing && state.sound) startAlarmAudio();
      }).catch(function () {});
    }
  }

  /* A six-note chime with a long tail, looped with a short silence so the
     console keeps ringing until a New order is acknowledged. */
  function alarmBuffer(ctx) {
    if (state.alarmBuffer) return state.alarmBuffer;

    var rate = ctx.sampleRate;
    var buffer = ctx.createBuffer(2, Math.floor(rate * 6.2), rate);
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(1);

    [
      [0.00, 784.00, 0.34, 0.50],
      [0.30, 987.77, 0.34, 0.52],
      [0.60, 1174.66, 0.42, 0.56],
      [0.98, 1567.98, 0.60, 0.62],
      [1.95, 784.00, 0.34, 0.50],
      [2.25, 987.77, 0.34, 0.52],
      [2.55, 1174.66, 0.42, 0.56],
      [2.93, 1567.98, 0.78, 0.62]
    ].forEach(function (note) {
      addTone(left, right, rate, note[0], note[1], note[2], note[3]);
    });

    state.alarmBuffer = buffer;
    return buffer;
  }

  function addTone(left, right, rate, start, frequency, duration, gain) {
    var first = Math.floor(start * rate);
    var total = Math.floor(duration * rate);
    for (var i = 0; i < total && first + i < left.length; i += 1) {
      var t = i / rate;
      var attack = Math.min(1, t / 0.012);
      var decay = Math.pow(1 - t / duration, 1.6);
      var wave =
        Math.sin(2 * Math.PI * frequency * t) * 0.82 +
        Math.sin(2 * Math.PI * frequency * 2 * t) * 0.18;
      var value = wave * attack * decay * gain;
      left[first + i] += value;
      right[first + i] += value * 0.94;
    }
  }

  function startAlarmAudio() {
    if (!state.sound || state.alarmSource) return;
    unlockAudio();

    var ctx = state.audio;
    if (!ctx || ctx.state !== "running") return;

    var source = ctx.createBufferSource();
    source.buffer = alarmBuffer(ctx);
    source.loop = true;

    var gain = ctx.createGain();
    gain.gain.value = 0.72;
    source.connect(gain);
    gain.connect(ctx.destination);

    try {
      source.start(0);
    } catch (err) {
      return;
    }
    state.alarmSource = source;
    state.alarmGain = gain;
  }

  function stopAlarmAudio() {
    if (state.alarmSource) {
      try { state.alarmSource.stop(); } catch (err) { /* already stopped */ }
      try { state.alarmSource.disconnect(); } catch (err) { /* ignore */ }
      state.alarmSource = null;
    }
    if (state.alarmGain) {
      try { state.alarmGain.disconnect(); } catch (err) { /* ignore */ }
      state.alarmGain = null;
    }
  }

  function startAlarm(count) {
    var first = !state.ringing;
    state.ringing = true;

    document.body.classList.add("is-ringing");
    $("#alarmBanner").hidden = false;
    $("#alarmText").textContent =
      count === 1 ? "New order ringing" : count + " new orders ringing";

    if (!first) return;

    startAlarmAudio();
    vibrate(ALARM_VIBRATE);
    state.alarmVibe = window.setInterval(function () {
      if (state.ringing) vibrate(ALARM_VIBRATE);
    }, ALARM_CYCLE_MS);
  }

  function stopAlarm() {
    if (!state.ringing && !state.alarmSource) return;

    state.ringing = false;
    stopAlarmAudio();
    if (state.alarmVibe) {
      window.clearInterval(state.alarmVibe);
      state.alarmVibe = null;
    }
    vibrate(0);
    document.body.classList.remove("is-ringing");
    $("#alarmBanner").hidden = true;
  }

  function syncAlarm(count) {
    if (count > 0) startAlarm(count);
    else stopAlarm();
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
  initNav();
  initQueue();
  initMenu();
  initAlerts();
  registerServiceWorker();
  initInstall();
})();
