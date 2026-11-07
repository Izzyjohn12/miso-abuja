/* MISO — storefront behaviour: menu, cart, checkout, WhatsApp handoff. */

(function () {
  "use strict";

  var CFG = window.MISO_CONFIG;
  var MENU = window.MISO_MENU || [];
  var SIGNATURES = window.MISO_SIGNATURES || [];
  if (!CFG) return;

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function money(value) {
    var n = Math.round(Number(value) || 0);
    return CFG.currency.symbol + n.toLocaleString("en-NG");
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function svgIcon(name) {
    return '<svg aria-hidden="true"><use href="#' + name + '"/></svg>';
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }
  function smoothScrollTo(el) {
    if (!el) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  var IMAGES = {
    sushi: { dir: "assets/img/menu/sushi", alt: "Salmon nigiri and maki rolls plated at the MISO sushi counter" },
    thai: { dir: "assets/img/menu/thai", alt: "Tom yum seafood soup with prawns, lemongrass and chilli" },
    grill: { dir: "assets/img/menu/grill", alt: "Suya skewers grilled over charcoal and dusted with yaji spice" },
    pasta: { dir: "assets/img/menu/pasta", alt: "Seafood pasta with prawns and calamari in a cream sauce" },
    indian: { dir: "assets/img/menu/indian", alt: "Chicken biryani with butter chicken and naan" }
  };

  function dishImage(key) {
    var meta = IMAGES[key];
    if (!meta) return null;
    return {
      dir: meta.dir,
      alt: meta.alt,
      src: meta.dir + "-800.webp",
      srcset: meta.dir + "-480.webp 480w, " + meta.dir + "-800.webp 800w, " + meta.dir + "-1024.webp 1024w",
      full: meta.dir + "-1024.webp"
    };
  }

  var TAG_LABELS = { spicy: "Spicy", veg: "Vegetarian", shellfish: "Contains shellfish" };

  var ITEMS = {};
  MENU.forEach(function (cat, ci) {
    cat.index = ci + 1;
    cat.groups.forEach(function (group) {
      group.items.forEach(function (item) {
        item.categoryId = cat.id;
        item.categoryName = cat.name;
        item.categoryIndex = cat.index;
        ITEMS[item.id] = item;
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /* cart state                                                          */
  /* ------------------------------------------------------------------ */

  var cart = readCart();

  function readCart() {
    try {
      var raw = window.localStorage.getItem(CFG.order.cartKey);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (line) {
        var item = ITEMS[line.id];
        return item && typeof item.price === "number" && line.qty > 0;
      }).map(function (line) {
        return {
          id: line.id,
          qty: Math.min(Math.max(parseInt(line.qty, 10) || 1, 1), CFG.order.maxQuantity),
          note: typeof line.note === "string" ? line.note.slice(0, 140) : ""
        };
      });
    } catch (err) {
      return [];
    }
  }

  function writeCart() {
    try {
      window.localStorage.setItem(CFG.order.cartKey, JSON.stringify(cart));
    } catch (err) {
      /* storage unavailable — the cart still works for this visit */
    }
  }

  function lines() {
    return cart.map(function (line) {
      var item = ITEMS[line.id];
      return {
        id: line.id,
        qty: line.qty,
        note: line.note,
        item: item,
        category: categoryById(item.categoryId),
        lineTotal: item.price * line.qty
      };
    });
  }

  function categoryById(id) {
    for (var i = 0; i < MENU.length; i++) if (MENU[i].id === id) return MENU[i];
    return null;
  }

  function itemCount() {
    return cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function subtotal() {
    return cart.reduce(function (sum, line) {
      return sum + ITEMS[line.id].price * line.qty;
    }, 0);
  }

  function addToCart(id) {
    var item = ITEMS[id];
    if (!item || typeof item.price !== "number") return;
    var existing = null;
    cart.forEach(function (line) { if (line.id === id) existing = line; });
    if (existing) {
      existing.qty = Math.min(existing.qty + 1, CFG.order.maxQuantity);
    } else {
      cart.push({ id: id, qty: 1, note: "" });
    }
    writeCart();
    renderCart();
    showToast(item.name + " added to your order", "i-check");
    var trigger = $("#cartTrigger");
    trigger.classList.remove("is-bump");
    void trigger.offsetWidth;
    trigger.classList.add("is-bump");
  }

  function setQty(id, qty) {
    var line = null;
    cart.forEach(function (l) { if (l.id === id) line = l; });
    if (!line) return;
    if (qty <= 0) {
      cart = cart.filter(function (l) { return l.id !== id; });
    } else {
      line.qty = Math.min(qty, CFG.order.maxQuantity);
    }
    writeCart();
    renderCart();
  }

  function setNote(id, note) {
    cart.forEach(function (line) {
      if (line.id === id) line.note = note.slice(0, 140);
    });
    writeCart();
    renderSummary();
  }

  /* ------------------------------------------------------------------ */
  /* totals                                                              */
  /* ------------------------------------------------------------------ */

  function currentService() {
    var checked = $("input[name=service]:checked");
    return checked ? checked.value : "dine-in";
  }

  var SERVICE_NAMES = {
    "dine-in": "Dine-in",
    pickup: "Pickup",
    maitama: "Delivery in Maitama",
    abuja: "Delivery across Abuja"
  };

  function isDelivery(service) {
    return service === "maitama" || service === "abuja";
  }

  function isDineIn(service) {
    return service === "dine-in";
  }

  function taxRate() {
    return CFG.tax && typeof CFG.tax.rate === "number" ? CFG.tax.rate : 0;
  }

  function taxLabel() {
    return "Tax (" + Math.round(taxRate() * 100) + "%)";
  }

  function totalsFor(service, sub) {
    var fee = 0;
    var feePending = false;
    var zone = CFG.delivery[service];
    if (zone) {
      if (typeof zone.fee === "number") fee = zone.fee;
      else feePending = true;
    }
    var tax = Math.round(sub * taxRate());
    return {
      subtotal: sub,
      tax: tax,
      taxLabel: taxLabel(),
      fee: fee,
      feePending: feePending,
      total: sub + tax + fee,
      dueNow: sub + tax + fee
    };
  }

  /* ------------------------------------------------------------------ */
  /* menu rendering                                                      */
  /* ------------------------------------------------------------------ */

  function renderSignatures() {
    var host = $("#signatureGrid");
    if (!host) return;
    host.innerHTML = SIGNATURES.map(function (sig, i) {
      var item = ITEMS[sig.itemId];
      var image = dishImage(sig.image);
      if (!item || !image) return "";
      return '' +
        '<article class="sig-card" data-reveal style="--delay:' + (i * 0.07) + 's">' +
          '<button class="sig-media" type="button" data-lightbox data-full="' + image.full + '" ' +
            'data-caption="' + escapeHtml(item.name) + ' — ' + escapeHtml(sig.note) + '" ' +
            'aria-label="View a larger image of ' + escapeHtml(item.name) + '">' +
            '<span class="sig-index">0' + (i + 1) + '</span>' +
            '<img src="' + image.src + '" srcset="' + image.srcset + '" ' +
              'sizes="(min-width: 1000px) 24vw, (min-width: 720px) 46vw, 78vw" width="1024" height="1280" ' +
              'loading="lazy" decoding="async" alt="' + escapeHtml(image.alt) + '">' +
          '</button>' +
          '<div class="sig-body">' +
            '<p class="sig-label">' + escapeHtml(sig.label) + '</p>' +
            '<div class="sig-row"><h3>' + escapeHtml(item.name) + '</h3>' +
              '<span class="sig-price">' + money(item.price) + '</span></div>' +
            '<p class="sig-note">' + escapeHtml(sig.note) + '</p>' +
            '<button class="sig-add" type="button" data-add="' + item.id + '">' +
              svgIcon("i-plus") + 'Add to order</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function itemMarkup(item) {
    var price;
    var action;
    if (typeof item.price === "number") {
      price = '<span class="menu-item__price">' + money(item.price) + "</span>";
      action = '<button class="item-add" type="button" data-add="' + item.id + '" ' +
        'aria-label="Add ' + escapeHtml(item.name) + ' to your order">' + svgIcon("i-plus") + "</button>";
    } else {
      price = '<span class="menu-item__price menu-item__price--ask">Price on request</span>';
      action = '<a class="item-ask" href="' + askLink(item) + '" target="_blank" rel="noopener">' +
        svgIcon("i-whatsapp") + "Ask the kitchen</a>";
    }
    var tags = (item.tags || []).filter(function (t) { return TAG_LABELS[t]; }).map(function (t) {
      return '<span class="tag tag--' + t + '">' + TAG_LABELS[t] + "</span>";
    }).join("");

    return '<li class="menu-item" data-name="' + escapeHtml(item.name.toLowerCase()) + '" ' +
      'data-desc="' + escapeHtml((item.desc || "").toLowerCase()) + '" ' +
      'data-category="' + escapeHtml(item.categoryName.toLowerCase()) + '" ' +
      'data-tags="' + escapeHtml((item.tags || []).join(" ")) + '">' +
      '<div class="menu-item__head">' +
        '<span class="menu-item__name">' + escapeHtml(item.name) + "</span>" +
        '<span class="menu-item__leader" aria-hidden="true"></span>' +
        price + action +
      "</div>" +
      (item.desc ? '<p class="menu-item__desc">' + escapeHtml(item.desc) + "</p>" : "") +
      (tags ? '<div class="menu-item__tags">' + tags + "</div>" : "") +
      "</li>";
  }

  function askLink(item) {
    var text = "Hello MISO, I found " + item.name +
      " on your website menu. Could you confirm the price and availability?";
    return waLink(CFG.whatsapp.waiter, text);
  }

  function renderMenu() {
    var root = $("#menuRoot");
    var tabs = $("#menuTabs");
    if (!root) return;

    root.innerHTML = MENU.map(function (cat) {
      var count = cat.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
      var image = dishImage(cat.image);
      var media = image
        ? '<figure class="category-media">' +
            '<img src="' + image.src + '" srcset="' + image.srcset + '" ' +
              'sizes="(min-width: 1000px) 26vw, (min-width: 720px) 50vw, 100vw" width="1024" height="1280" ' +
              'loading="lazy" decoding="async" alt="' + escapeHtml(image.alt) + '">' +
          "</figure>"
        : '<div class="category-media"><div class="category-tile" aria-hidden="true">小皿</div></div>';

      return '<article class="menu-category" id="menu-' + cat.id + '" data-category="' + cat.id + '" data-reveal>' +
        '<header class="category-head">' +
          "<div>" +
            '<span class="category-index">' + pad2(cat.index) + " — " + cat.groups.length + " sections</span>" +
            "<h3>" + escapeHtml(cat.name) + "</h3>" +
            '<p class="category-kicker">' + escapeHtml(cat.kicker || "") + "</p>" +
            '<p class="category-blurb">' + escapeHtml(cat.blurb || "") + "</p>" +
          "</div>" +
          media +
        "</header>" +
        '<div class="menu-groups">' +
          cat.groups.map(function (group) {
            return '<section class="menu-group">' +
              '<h4 class="menu-group__title">' + escapeHtml(group.name) + "</h4>" +
              '<ul class="menu-list">' +
                group.items.map(itemMarkup).join("") +
              "</ul></section>";
          }).join("") +
        "</div>" +
      "</article>";
    }).join("");

    tabs.innerHTML = MENU.map(function (cat, i) {
      var count = cat.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
      return '<button class="menu-tab" type="button" data-tab="' + cat.id + '">' +
        pad2(i + 1) + " " + escapeHtml(cat.name) + " <small>" + count + "</small></button>";
    }).join("");

    var total = Object.keys(ITEMS).length;
    root.insertAdjacentHTML("beforeend",
      '<div class="menu-empty" id="menuEmptyState" hidden>' +
        "<h3>Nothing matches that.</h3>" +
        "<p>Try a shorter search, clear the filter, or ask the kitchen directly — we adapt dishes when we can.</p>" +
        '<a class="btn btn--outline" href="' + waLink(CFG.whatsapp.waiter, "Hello MISO, I am looking for a dish on your menu:") +
        '" target="_blank" rel="noopener">' + svgIcon("i-whatsapp") + "Ask on WhatsApp</a>" +
      "</div>");

    $("#menuStatus").textContent = total + " dishes · " + MENU.length + " sections · prices in naira";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* ------------------------------------------------------------------ */
  /* menu search & filter                                                */
  /* ------------------------------------------------------------------ */

  function applyFilters() {
    var query = ($("#menuSearch").value || "").trim().toLowerCase();
    var filter = $("#menuFilter").value;
    var matches = 0;

    MENU.forEach(function (cat) {
      var section = $("#menu-" + cat.id);
      if (!section) return;
      var visibleInCategory = 0;

      $$(".menu-group", section).forEach(function (group) {
        var visibleInGroup = 0;
        $$(".menu-item", group).forEach(function (row) {
          var haystack = row.getAttribute("data-name") + " " +
            row.getAttribute("data-desc") + " " + row.getAttribute("data-category");
          var tags = row.getAttribute("data-tags") || "";
          var okQuery = !query || haystack.indexOf(query) !== -1;
          var okFilter = filter === "all" || tags.split(" ").indexOf(filter) !== -1;
          var show = okQuery && okFilter;
          row.hidden = !show;
          if (show) {
            visibleInGroup++;
            visibleInCategory++;
          }
        });
        group.hidden = visibleInGroup === 0;
      });

      section.hidden = visibleInCategory === 0;
      var tab = $('.menu-tab[data-tab="' + cat.id + '"]');
      if (tab) tab.hidden = visibleInCategory === 0;
      matches += visibleInCategory;
    });

    var empty = $("#menuEmptyState");
    if (empty) empty.hidden = matches !== 0;

    var status = $("#menuStatus");
    if (query || filter !== "all") {
      var bits = [];
      if (query) bits.push('"' + query + '"');
      if (filter !== "all") bits.push(TAG_LABELS[filter].toLowerCase());
      status.textContent = matches + (matches === 1 ? " dish matches " : " dishes match ") + bits.join(" + ");
    } else {
      status.textContent = Object.keys(ITEMS).length + " dishes · " + MENU.length + " sections · prices in naira";
    }
  }

  /* ------------------------------------------------------------------ */
  /* cart drawer                                                         */
  /* ------------------------------------------------------------------ */

  function renderCart() {
    var list = lines();
    var count = itemCount();
    var badge = $("#cartCount");

    badge.textContent = count;
    badge.setAttribute("data-empty", count === 0 ? "true" : "false");
    badge.setAttribute("aria-hidden", "true");

    $("#cartEmpty").hidden = list.length > 0;
    $("#cartFoot").hidden = list.length === 0;
    $("#cartLines").hidden = list.length === 0;
    $("#cartLines").innerHTML = list.map(cartLineMarkup).join("");
    $("#cartSubtotal").textContent = money(subtotal());
    $("#cartDeliveryNote").textContent = list.length
      ? "10% tax is added at checkout. Delivery is quoted from Bolt for your address."
      : "Delivery is quoted from Bolt at checkout.";

    var bar = $("#orderBar");
    bar.hidden = count === 0;
    $("#orderBarCount").textContent = count + (count === 1 ? " item" : " items");
    $("#orderBarTotal").textContent = money(subtotal());

    renderSummary();
  }

  function cartLineMarkup(line) {
    var image = dishImage(line.category && line.category.image);
    var thumb = image
      ? '<img class="cart-line__thumb" src="' + image.dir + '-thumb.webp" width="240" height="240" alt="" loading="lazy">'
      : '<div class="cart-line__thumb cart-line__tile" aria-hidden="true">小</div>';

    return '<li class="cart-line" data-line-id="' + line.id + '">' +
      thumb +
      '<div class="cart-line__body">' +
        '<p class="cart-line__title">' + escapeHtml(line.item.name) + "</p>" +
        '<p class="cart-line__meta">' + money(line.item.price) + " each · " + escapeHtml(line.item.categoryName) + "</p>" +
        '<div class="qty">' +
          '<button class="qty__button" type="button" data-dec="' + line.id + '" aria-label="Decrease ' + escapeHtml(line.item.name) + '">' + svgIcon("i-minus") + "</button>" +
          '<span class="qty__value">' + line.qty + "</span>" +
          '<button class="qty__button" type="button" data-inc="' + line.id + '" aria-label="Increase ' + escapeHtml(line.item.name) + '">' + svgIcon("i-plus") + "</button>" +
        "</div>" +
        '<button class="cart-line__toggle" type="button" data-note-toggle="' + line.id + '">' +
          (line.note ? "Edit note" : "Add a note") + "</button>" +
      "</div>" +
      '<div class="cart-line__right">' +
        '<span class="cart-line__total">' + money(line.lineTotal) + "</span>" +
        '<button class="cart-line__remove" type="button" data-remove="' + line.id + '" ' +
          'aria-label="Remove ' + escapeHtml(line.item.name) + ' from your order">' + svgIcon("i-trash") + "</button>" +
      "</div>" +
      '<div class="cart-line__note-field" data-note-field="' + line.id + '"' + (line.note ? "" : " hidden") + ">" +
        '<label class="sr-only" for="note-' + line.id + '">Note for ' + escapeHtml(line.item.name) + "</label>" +
        '<input type="text" id="note-' + line.id + '" data-note-input="' + line.id + '" maxlength="140" ' +
          'placeholder="No shellfish, extra chilli…" value="' + escapeHtml(line.note) + '">' +
      "</div>" +
    "</li>";
  }

  /* ------------------------------------------------------------------ */
  /* checkout summary                                                    */
  /* ------------------------------------------------------------------ */

  function renderSummary(snapshot) {
    var data = snapshot || buildLiveSummary();
    $("#summaryCount").textContent = data.count + (data.count === 1 ? " item" : " items");
    $("#summaryItems").innerHTML = data.items.length
      ? data.items.map(function (row) {
          return "<li><strong>" + row.qty + " × " + row.name + "</strong><span>" + row.total + "</span>" +
            (row.note ? "<em>" + row.note + "</em>" : "") + "</li>";
        }).join("")
      : '<li><span>No dishes yet</span></li>';

    $("#summaryService").innerHTML = "<span>Service</span><strong>" + data.serviceLabel + "</strong>";
    $("#summarySubtotal").textContent = data.subtotal;
    $("#summaryTaxLabel").textContent = data.taxLabel;
    $("#summaryTax").textContent = data.tax;

    var deliveryRow = $("#summaryDeliveryRow");
    deliveryRow.hidden = !isDelivery(data.service);
    if (!deliveryRow.hidden) {
      $("#summaryDeliveryLabel").textContent = "Delivery · " + CFG.delivery[data.service].label;
      $("#summaryDelivery").textContent = data.feePending ? "Bolt quote on WhatsApp" : data.fee;
    }
    $("#summaryTotalLabel").textContent = isDineIn(data.service)
      ? "Amount due"
      : (data.feePending ? "Due now" : "Total");
    $("#summaryTotal").textContent = data.total;
    $("#summaryNote").textContent = isDineIn(data.service)
      ? DINE_IN_COPY.summaryNote
      : (data.feePending
        ? "Food and tax now · Bolt delivery quoted before dispatch."
        : STANDARD_COPY.summaryNote);
  }

  function buildLiveSummary() {
    var service = currentService();
    var t = totalsFor(service, subtotal());
    return {
      service: service,
      count: itemCount(),
      items: lines().map(function (line) {
        return {
          qty: line.qty,
          name: escapeHtml(line.item.name),
          total: money(line.lineTotal),
          note: line.note ? escapeHtml(line.note) : ""
        };
      }),
      serviceLabel: escapeHtml(serviceDescription(service)),
      subtotal: money(t.subtotal),
      tax: money(t.tax),
      taxLabel: t.taxLabel,
      fee: money(t.fee),
      feePending: t.feePending,
      total: money(t.dueNow)
    };
  }

  function serviceDescription(service) {
    if (isDelivery(service)) {
      return "Delivery · " + CFG.delivery[service].label +
        (typeof CFG.delivery[service].fee === "number" ? " (" + money(CFG.delivery[service].fee) + ")" : " (Bolt quote on WhatsApp)");
    }
    if (service === "pickup") {
      var slot = $("#pickupTime").value;
      return "Pickup" + (slot ? " · " + slot : "");
    }
    var table = $("#tableNumber").value.trim();
    return "Dine-in" + (table ? " · Table " + table : "");
  }

  /* ------------------------------------------------------------------ */
  /* form: service panels & validation                                   */
  /* ------------------------------------------------------------------ */

  var RULES = [
    { id: "pickupTime", services: ["pickup"], message: "Choose a pickup time." },
    { id: "maitamaAddress", services: ["maitama"], message: "Add the delivery address." },
    { id: "abujaArea", services: ["abuja"], message: "Which area of Abuja?" },
    { id: "abujaAddress", services: ["abuja"], message: "Add the delivery address." },
    { id: "customerName", services: ["pickup", "maitama", "abuja"], message: "We need a name for the order.", min: 2 },
    { id: "customerPhone", services: ["pickup", "maitama", "abuja"], message: "Add a phone number we can reach on WhatsApp.", phone: true }
  ];

  var DINE_IN_COPY = {
    detailsNote: "Check the dishes, add a note if you need to, then send it to the team.",
    reviewLabel: "Review table order",
    paymentHeading: "Pay now or after your meal",
    paymentLead: "Your table order can be placed without payment. Settle whenever you like — from your banking app now, or at the table after eating. Send the order to the team after this step.",
    amountLabel: "Amount due",
    payStep1: "Pay from your banking app now, or settle at the table after your meal — <strong id=\"payStepAmount\">AMOUNT</strong>. Either is fine.",
    payStep3: "Continue to the next step and send the order on WhatsApp. No receipt is needed to place it.",
    laterNote: "Dine-in orders are placed without payment. Settle now from your banking app or at the table after your meal — just show the reference so the team can match it.",
    confirmHeading: "Send your table order to the team.",
    confirmLede: "Your order is saved. Send it on WhatsApp so the floor team and kitchen see it straight away. Settle before or after your meal — no receipt is needed to place it.",
    next1: "Send the table order on WhatsApp.",
    next2: "The floor team and kitchen pick it up from the chat.",
    next3: "Pay before or after eating — the bank details stay in this order.",
    confirmNote: "This screen confirms your order details, not payment. Your order is confirmed when the team replies on WhatsApp; pay whenever suits you.",
    summaryNote: "Bank transfer · pay before or after your meal",
    handoff: "Send table order",
    handoffSmall: "Floor and kitchen · pay before or after"
  };

  var STANDARD_COPY = {
    detailsNote: "You will see the full review before paying.",
    reviewLabel: "Review order",
    paymentHeading: "Pay by bank transfer",
    paymentLead: "Transfer the amount below, using your order reference as the narration. Then send the order on WhatsApp with your receipt attached.",
    amountLabel: "Amount to transfer",
    payStep1: "Open your banking app and transfer <strong id=\"payStepAmount\">AMOUNT</strong> to the account shown.",
    payStep3: "Continue to the next step, send the order on WhatsApp and attach a screenshot of the receipt.",
    confirmHeading: "One last step — send it to the team.",
    confirmLede: "Your order summary is prepared. Send it on WhatsApp and attach your transfer receipt so the floor team and kitchen see it straight away.",
    next1: "Send the order on WhatsApp.",
    next2: "Attach your transfer receipt to that chat.",
    next3: "The team confirms payment and starts your order.",
    confirmNote: "This screen is not a payment confirmation. Your order is confirmed when the team replies on WhatsApp.",
    summaryNote: "Bank transfer · receipt attached on WhatsApp",
    handoff: "Send order to the team",
    handoffSmall: "Waiter and kitchen · one chat"
  };

  function serviceCopy(service) {
    return isDineIn(service) ? DINE_IN_COPY : STANDARD_COPY;
  }

  function applyServiceCopy(service) {
    var dine = isDineIn(service);
    var copy = serviceCopy(service);
    $("#detailsNote").textContent = copy.detailsNote;
    $("#reviewOrderLabel").textContent = copy.reviewLabel;
    $("#step1Name").textContent = dine ? "Table" : "Details";
    $$("[data-contact-field]").forEach(function (label) {
      label.hidden = dine;
      $$("input", label).forEach(function (input) {
        input.disabled = dine;
      });
    });
    if (dine) {
      clearError("customerName");
      clearError("customerPhone");
    }
  }

  function setServicePanels(service) {
    $$("[data-service-panel]").forEach(function (panel) {
      var active = panel.getAttribute("data-service-panel") === service;
      panel.hidden = !active;
      $$("input, select, textarea", panel).forEach(function (field) {
        field.disabled = !active;
        if (active) field.removeAttribute("aria-invalid");
        var err = $('[data-error-for="' + field.id + '"]');
        if (err && active) err.textContent = "";
      });
    });
    applyServiceCopy(service);
    if (!$('[data-step-panel="1"]').hidden) {
      $("#checkoutTitle").textContent = isDineIn(service) ? "Your table" : STEP_TITLES[1];
    }
    renderSummary();
  }

  function clearError(id) {
    var field = $("#" + id);
    var err = $('[data-error-for="' + id + '"]');
    if (field) field.removeAttribute("aria-invalid");
    if (err) err.textContent = "";
  }

  function validateForm() {
    var service = currentService();
    var firstBad = null;

    RULES.forEach(function (rule) {
      var applies = rule.services.indexOf("*") !== -1 || rule.services.indexOf(service) !== -1;
      var field = $("#" + rule.id);
      if (!applies || !field) return;
      var value = field.value.trim();
      var error = "";

      if (!value) {
        error = rule.message;
      } else if (rule.min && value.length < rule.min) {
        error = rule.message;
      } else if (rule.phone) {
        var digits = value.replace(/[^0-9]/g, "");
        if (digits.length < 8 || digits.length > 15) error = "That number looks too short. Use e.g. 0801 234 5678.";
      }

      var errHost = $('[data-error-for="' + rule.id + '"]');
      if (error) {
        field.setAttribute("aria-invalid", "true");
        if (errHost) errHost.textContent = error;
        if (!firstBad) firstBad = field;
      } else {
        clearError(rule.id);
      }
    });

    if (firstBad) {
      firstBad.focus();
      firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
      showToast("Please complete the highlighted fields", "i-close");
      return false;
    }
    return true;
  }

  function collectDetails() {
    function value(id) {
      var el = $("#" + id);
      return el ? el.value.trim() : "";
    }
    var service = currentService();
    return {
      service: service,
      serviceLabel: SERVICE_NAMES[service],
      tableNumber: value("tableNumber"),
      pickupTime: value("pickupTime"),
      maitamaAddress: value("maitamaAddress"),
      maitamaLandmark: value("maitamaLandmark"),
      abujaArea: value("abujaArea"),
      abujaAddress: value("abujaAddress"),
      abujaLandmark: value("abujaLandmark"),
      name: value("customerName"),
      phone: value("customerPhone"),
      notes: value("orderNotes")
    };
  }

  function serviceDetail(details) {
    switch (details.service) {
      case "dine-in":
        return details.tableNumber ? "Table " + details.tableNumber : "Seated at the rooftop";
      case "pickup":
        return details.pickupTime || "Pickup";
      case "maitama":
        return details.maitamaAddress + (details.maitamaLandmark ? " (landmark: " + details.maitamaLandmark + ")" : "");
      case "abuja":
        return details.abujaAddress + ", " + details.abujaArea +
          (details.abujaLandmark ? " (landmark: " + details.abujaLandmark + ")" : "");
      default:
        return "";
    }
  }

  function readyBy(details) {
    if (details.service === "pickup") return details.pickupTime || "As soon as possible";
    if (details.service === "dine-in") return "Fire now — table service";
    return "As soon as payment is confirmed";
  }

  /* ------------------------------------------------------------------ */
  /* order object & messages                                             */
  /* ------------------------------------------------------------------ */

  var activeOrder = null;
  var pendingRef = null;
  var pendingToken = null;
  var checkoutEntry = null;

  function newReference() {
    var d = new Date();
    var stamp = String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var suffix = Math.floor(1000 + Math.random() * 9000);
    return CFG.order.prefix + "-" + stamp + "-" + suffix;
  }

  function newClientToken() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function buildOrder() {
    var details = collectDetails();
    var t = totalsFor(details.service, subtotal());
    if (!pendingToken) pendingToken = newClientToken();
    return {
      ref: pendingRef || newReference(),
      clientToken: pendingToken,
      placedAt: new Date().toISOString(),
      details: details,
      serviceDetail: serviceDetail(details),
      readyBy: readyBy(details),
      lines: lines().map(function (line) {
        return {
          id: line.item.id,
          categoryId: line.item.categoryId,
          name: line.item.name,
          qty: line.qty,
          price: line.item.price,
          total: line.lineTotal,
          note: line.note,
          tags: line.item.tags || [],
          category: line.item.categoryName
        };
      }),
      subtotal: t.subtotal,
      tax: t.tax,
      taxRate: taxRate(),
      fee: t.fee,
      feePending: t.feePending,
      total: t.total,
      dueNow: t.dueNow
    };
  }

  function orderText(order) {
    var l = [];
    var dine = isDineIn(order.details.service);
    l.push("MISO — new order");
    l.push("Reference: " + order.ref);
    l.push("");
    l.push("Service: " + order.details.serviceLabel + " · " + order.serviceDetail);
    if (!dine) {
      l.push("Guest: " + order.details.name);
      l.push("Phone: " + order.details.phone);
    }
    if (order.details.notes) l.push("Order notes: " + order.details.notes);
    l.push("");
    l.push("Order");
    order.lines.forEach(function (line) {
      l.push(line.qty + " x " + line.name + " — " + money(line.total));
      if (line.note) l.push("      note: " + line.note);
    });
    l.push("");
    l.push("Subtotal: " + money(order.subtotal));
    l.push(taxLabel() + ": " + money(order.tax));
    if (isDelivery(order.details.service)) {
      var zone = CFG.delivery[order.details.service];
      if (order.feePending) {
        l.push("Delivery (" + zone.label + ", Bolt): to quote on WhatsApp");
      } else {
        l.push("Delivery (" + zone.label + "): " + money(order.fee));
      }
    }
    l.push((dine ? "Amount due: " : "Amount to transfer now: ") + money(order.dueNow));
    l.push("");
    l.push(dine ? "Payment: bank transfer — before or after the meal" : "Payment: bank transfer");
    l.push("Bank: " + CFG.bank.bankName);
    l.push("Account name: " + CFG.bank.accountName);
    l.push("Account number: " + CFG.bank.accountNumber);
    l.push("Reference: " + order.ref);
    l.push("");
    l.push(dine
      ? "Dine-in order placed online — no receipt needed to send it."
      : "Placed online — receipt attached to this chat.");
    return l.join("\n");
  }

  function kitchenText(order) {
    var l = [];
    l.push("MISO — kitchen ticket");
    l.push("Reference: " + order.ref);
    l.push("Service: " + order.details.serviceLabel + " · " + order.serviceDetail);
    l.push("Timing: " + order.readyBy);
    l.push("");
    l.push("Plates");
    order.lines.forEach(function (line) {
      var suffix = line.tags.length ? " (" + line.tags.join(", ") + ")" : "";
      l.push(line.qty + " x " + line.name + suffix);
      if (line.note) l.push("      * " + line.note);
    });
    var plates = order.lines.reduce(function (n, line) { return n + line.qty; }, 0);
    l.push("");
    l.push(plates + (plates === 1 ? " plate" : " plates") + " for " + order.details.serviceLabel.toLowerCase());
    if (order.details.notes) l.push("Guest notes: " + order.details.notes);
    return l.join("\n");
  }

  function waLink(number, text) {
    var digits = String(number).replace(/[^0-9]/g, "");
    return "https://wa.me/" + digits + "?text=" + encodeURIComponent(text);
  }

  function sameNumber() {
    return String(CFG.whatsapp.waiter).replace(/\D/g, "") === String(CFG.whatsapp.chef).replace(/\D/g, "");
  }

  function renderHandoff(order) {
    var host = $("#confirmActions");
    var dine = isDineIn(order.details.service);
    if (sameNumber()) {
      var combined = orderText(order) + "\n\n——————\n\n" + kitchenText(order);
      host.innerHTML =
        '<a class="handoff handoff--primary" href="' + waLink(CFG.whatsapp.waiter, combined) + '" target="_blank" rel="noopener">' +
          '<span class="handoff__text">' + (dine ? DINE_IN_COPY.handoff : STANDARD_COPY.handoff) +
            '<small>' + (dine ? DINE_IN_COPY.handoffSmall : STANDARD_COPY.handoffSmall) + '</small></span>' +
          svgIcon("i-whatsapp") + "</a>";
      return;
    }
    host.innerHTML =
      '<a class="handoff handoff--primary" href="' + waLink(CFG.whatsapp.waiter, orderText(order)) + '" target="_blank" rel="noopener">' +
        '<span class="handoff__text">' + (dine ? "Send table order to the waiter" : "Send order to the waiter") +
          '<small>' + (dine ? "Table number, dishes and amount due" : "Full order, total and payment reference") + '</small></span>' +
        svgIcon("i-whatsapp") + "</a>" +
      '<a class="handoff handoff--ghost" href="' + waLink(CFG.whatsapp.chef, kitchenText(order)) + '" target="_blank" rel="noopener">' +
        '<span class="handoff__text">Send ticket to the chef<small>Plates, quantities and kitchen notes</small></span>' +
        svgIcon("i-whatsapp") + "</a>";
  }

  /* ------------------------------------------------------------------ */
  /* checkout steps                                                      */
  /* ------------------------------------------------------------------ */

  var STEP_TITLES = { 1: "Your details", 2: "Payment", 3: "Send your order" };

  function goStep(n) {
    $$(".step-panel").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-step-panel") !== String(n);
    });
    $$("#checkoutSteps li").forEach(function (li) {
      var index = Number(li.getAttribute("data-step-indicator"));
      li.classList.toggle("is-active", index === n);
      li.classList.toggle("is-done", index < n);
    });
    $("#checkoutTitle").textContent = n === 1 && isDineIn(currentService())
      ? "Your table"
      : STEP_TITLES[n];

    var heading = $('[data-step-panel="' + n + '"] .step-title');
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    var body = $(".checkout__main");
    if (body) body.scrollTop = 0;
    var bodyWrap = $(".checkout__body");
    if (bodyWrap) bodyWrap.scrollTop = 0;
  }

  function openCheckout() {
    if (!cart.length) {
      showToast("Add at least one dish first", "i-close");
      return;
    }
    pendingRef = newReference();
    pendingToken = newClientToken();
    activeOrder = null;
    goStep(1);
    renderSummary();
    if (cartDrawerEntry) {
      Layer.close(cartDrawerEntry);
      cartDrawerEntry = null;
    }
    checkoutEntry = Layer.open($("#checkout"), {
      backdrop: $("#checkoutBackdrop"),
      restore: $("#cartTrigger")
    });
  }

  function applyPaymentCopy(order) {
    var dine = isDineIn(order.details.service);
    var copy = serviceCopy(order.details.service);
    $("#paymentHeading").textContent = copy.paymentHeading;
    $("#paymentLead").textContent = copy.paymentLead;
    $("#bankAmountLabel").textContent = copy.amountLabel;
    $("#payStep1Text").innerHTML = copy.payStep1.replace("AMOUNT", money(order.dueNow));
    $("#payStep3Text").textContent = copy.payStep3;
    $("#payLaterNote").textContent = DINE_IN_COPY.laterNote;
    $("#payLaterNote").hidden = !dine;
    $("#transferConfirmRow").hidden = dine;
    $("#transferConfirm").disabled = dine;
    $("#transferConfirm").checked = false;
    $("#paymentContinue").disabled = !dine;
  }

  function applyConfirmCopy(order) {
    var copy = serviceCopy(order.details.service);
    $("#confirmHeading").textContent = copy.confirmHeading;
    $("#confirmLede").textContent = copy.confirmLede;
    $("#nextStep1").textContent = copy.next1;
    $("#nextStep2").textContent = copy.next2;
    $("#nextStep3").textContent = copy.next3;
    $("#confirmNote").textContent = copy.confirmNote;
  }

  function toPayment() {
    var order = buildOrder();
    activeOrder = order;
    $("#bankName").textContent = CFG.bank.bankName;
    $("#bankAccountName").textContent = CFG.bank.accountName;
    $("#bankAccountNumber").textContent = CFG.bank.accountNumber;
    $("#bankReference").textContent = order.ref;
    $("#bankAmount").textContent = money(order.dueNow);
    $("#payStepReference").textContent = order.ref;
    $("#bankPreviewBadge").hidden = !CFG.bank.preview;
    $("#bankWarning").hidden = !CFG.bank.preview;
    $("#payDeliveryNote").hidden = !order.feePending;
    applyPaymentCopy(order);
    renderSummary(orderSnapshotForSummary(order));
    goStep(2);
  }

  function orderSnapshotForSummary(order) {
    return {
      service: order.details.service,
      count: order.lines.reduce(function (n, line) { return n + line.qty; }, 0),
      items: order.lines.map(function (line) {
        return {
          qty: line.qty,
          name: escapeHtml(line.name),
          total: money(line.total),
          note: line.note ? escapeHtml(line.note) : ""
        };
      }),
      serviceLabel: escapeHtml(SERVICE_NAMES[order.details.service] + " · " + order.serviceDetail),
      subtotal: money(order.subtotal),
      tax: money(order.tax),
      taxLabel: taxLabel(),
      fee: money(order.fee),
      feePending: order.feePending,
      total: money(order.dueNow)
    };
  }

  function finishOrder() {
    var order = activeOrder || buildOrder();
    activeOrder = order;
    applyConfirmCopy(order);
    renderHandoff(order);
    $("#confirmReference").textContent = order.ref;

    try {
      window.localStorage.setItem(CFG.order.lastOrderKey, JSON.stringify(order));
      window.localStorage.setItem(CFG.order.cartKey, "[]");
    } catch (err) {
      /* ignore */
    }
    cart = [];
    renderCart();

    /* renderCart() refreshes the summary from the emptied cart, so write the
       frozen order snapshot back before showing the final step. */
    renderSummary(orderSnapshotForSummary(order));

    goStep(3);
    showToast("Order prepared — send it on WhatsApp", "i-whatsapp");
    submitOrder(order);
  }

  /* ------------------------------------------------------------------ */
  /* kitchen submission (the WhatsApp handoff stays the fallback)        */
  /* ------------------------------------------------------------------ */

  var OUTBOX_KEY = "miso-outbox-v1";
  var outboxFlushing = false;

  function submitStatus(kind, message) {
    var el = $("#submitStatus");
    if (!el) return;
    el.hidden = false;
    el.className = "submit-status submit-status--" + kind;
    el.textContent = message;
  }

  function postOrder(payload) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, 6000)
      : null;

    return fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MISO-CSRF": "1" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      keepalive: true,
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (timer) clearTimeout(timer);
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { status: response.status, data: data };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function readOutbox() {
    try {
      var raw = window.localStorage.getItem(OUTBOX_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeOutbox(list) {
    try {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-5)));
    } catch (err) {
      /* storage may be full or blocked */
    }
  }

  function queueOrder(payload) {
    var list = readOutbox().filter(function (entry) {
      return entry && entry.payload && entry.payload.clientToken !== payload.clientToken;
    });
    list.push({ payload: payload, queuedAt: new Date().toISOString() });
    writeOutbox(list);
  }

  function dropOutbox(token) {
    writeOutbox(readOutbox().filter(function (entry) {
      return entry && entry.payload && entry.payload.clientToken !== token;
    }));
  }

  function submitOrder(order) {
    var payload = {
      ref: order.ref,
      clientToken: order.clientToken,
      service: order.details.service,
      details: order.details,
      lines: order.lines.map(function (line) {
        return { id: line.id, qty: line.qty, note: line.note };
      }),
      clientTotal: order.dueNow
    };

    submitStatus("pending", "Sending your order to the kitchen…");
    postOrder(payload).then(function (result) {
      var data = result.data || {};
      if (result.status === 200 || result.status === 201) {
        dropOutbox(payload.clientToken);
        submitStatus("ok", "Kitchen notified — your order is on their screen. Keep this WhatsApp message for your receipt.");
        return;
      }
      if (result.status === 409 && data.error === "menu_changed") {
        submitStatus("warn", "A dish changed while you were ordering. Send this order on WhatsApp and the team will confirm it.");
        return;
      }
      if (result.status === 429) {
        submitStatus("warn", "Too many orders from this device just now. Send this one on WhatsApp.");
        return;
      }
      if (result.status >= 400 && result.status < 500) {
        submitStatus("warn", "The kitchen could not take this order automatically — send it on WhatsApp.");
        return;
      }
      throw new Error("order_submit_failed");
    }).catch(function () {
      queueOrder(payload);
      submitStatus("warn", "Couldn't reach the kitchen — send this order on WhatsApp. We'll retry automatically.");
    });
  }

  function flushOutbox() {
    if (outboxFlushing) return;
    var pending = readOutbox();
    if (!pending.length) return;
    if (navigator.onLine === false) return;

    outboxFlushing = true;
    (function next() {
      if (!pending.length) {
        outboxFlushing = false;
        return;
      }
      var entry = pending.shift();
      var payload = entry && entry.payload;
      if (!payload || !payload.clientToken) {
        next();
        return;
      }
      postOrder(payload).then(function (result) {
        if ((result.status >= 200 && result.status < 300) || result.status === 409) {
          dropOutbox(payload.clientToken);
          next();
        } else {
          outboxFlushing = false;
        }
      }).catch(function () {
        outboxFlushing = false;
      });
    })();
  }

  function closeCheckout(resetForm) {
    if (checkoutEntry) {
      Layer.close(checkoutEntry);
      checkoutEntry = null;
    }
    if (resetForm) {
      activeOrder = null;
      pendingRef = null;
      pendingToken = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* clipboard                                                           */
  /* ------------------------------------------------------------------ */

  function copyText(text, label) {
    var done = function () { showToast((label || "Copied") + " copied to your clipboard", "i-copy"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch (err) {
      showToast("Select and copy manually", "i-close");
    }
    document.body.removeChild(area);
  }

  /* ------------------------------------------------------------------ */
  /* overlays, focus trap, escape                                        */
  /* ------------------------------------------------------------------ */

  var Layer = {
    stack: [],
    open: function (el, opts) {
      opts = opts || {};
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      document.body.classList.add("has-overlay");
      var backdrop = opts.backdrop;
      if (backdrop) {
        backdrop.hidden = false;
      }
      this.stack.push({
        el: el,
        backdrop: backdrop,
        restore: opts.restore || document.activeElement
      });
      window.setTimeout(function () {
        el.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-open");
      }, 20);
      var focusTarget = opts.focus || firstFocusable(el);
      if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 80);
      return this.stack[this.stack.length - 1];
    },
    close: function (entry) {
      if (!entry) return;
      var index = this.stack.indexOf(entry);
      if (index === -1) return;
      this.stack.splice(index, 1);
      var el = entry.el;
      el.classList.remove("is-open");
      el.setAttribute("aria-hidden", "true");
      if (entry.backdrop) entry.backdrop.classList.remove("is-open");
      setTimeout(function () {
        el.hidden = true;
        if (entry.backdrop) entry.backdrop.hidden = true;
      }, 380);
      if (!this.stack.length) document.body.classList.remove("has-overlay");
      if (entry.restore && typeof entry.restore.focus === "function" && entry.restore.offsetParent !== null) {
        entry.restore.focus();
      }
    },
    top: function () {
      return this.stack[this.stack.length - 1];
    }
  };

  function firstFocusable(el) {
    var nodes = $$('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', el);
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].disabled && nodes[i].offsetParent !== null) return nodes[i];
    }
    return null;
  }

  function trapTab(e) {
    var top = Layer.top();
    if (!top) return;
    var focusables = $$('button, [href], input:not([type=hidden]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])', top.el)
      .filter(function (n) { return !n.disabled && n.offsetParent !== null && !n.closest("[hidden]"); });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  var cartDrawerEntry = null;

  function openCart() {
    if (Layer.stack.length) return;
    cartDrawerEntry = Layer.open($("#cartDrawer"), {
      backdrop: $("#drawerBackdrop"),
      focus: $("#cartClose")
    });
  }

  function closeCart() {
    if (cartDrawerEntry) {
      Layer.close(cartDrawerEntry);
      cartDrawerEntry = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* lightbox                                                            */
  /* ------------------------------------------------------------------ */

  var lightboxState = { items: [], index: 0, entry: null };

  function openLightbox(trigger) {
    var items = $$("[data-lightbox]");
    lightboxState.items = items;
    lightboxState.index = items.indexOf(trigger);
    if (lightboxState.index < 0) lightboxState.index = 0;
    paintLightbox();
    lightboxState.entry = Layer.open($("#lightbox"), { focus: $("#lightboxClose") });
  }

  function paintLightbox() {
    var total = lightboxState.items.length;
    var item = lightboxState.items[lightboxState.index];
    if (!item) return;
    var img = item.querySelector("img");
    $("#lightboxImage").src = item.getAttribute("data-full") || (img ? img.src : "");
    $("#lightboxImage").alt = img ? img.alt : "";
    $("#lightboxCaption").textContent = item.getAttribute("data-caption") || (img ? img.alt : "");
    $("#lightboxCount").textContent = (lightboxState.index + 1) + " / " + total;
    $("#lightboxPrev").hidden = total < 2;
    $("#lightboxNext").hidden = total < 2;
  }

  function stepLightbox(delta) {
    var total = lightboxState.items.length;
    if (total < 2) return;
    lightboxState.index = (lightboxState.index + delta + total) % total;
    paintLightbox();
  }

  function closeLightbox() {
    if (lightboxState.entry) {
      Layer.close(lightboxState.entry);
      lightboxState.entry = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* feedback                                                            */
  /* ------------------------------------------------------------------ */

  var feedbackEntry = null;

  function openFeedback(trigger) {
    if (Layer.stack.length) return;
    $("#feedbackForm").reset();
    clearError("feedbackMessage");
    feedbackEntry = Layer.open($("#feedback"), {
      backdrop: $("#feedbackBackdrop"),
      restore: trigger || document.activeElement,
      focus: $("#feedbackClose")
    });
  }

  function closeFeedback() {
    if (feedbackEntry) {
      Layer.close(feedbackEntry);
      feedbackEntry = null;
    }
  }

  function feedbackText() {
    var rating = $('input[name="rating"]:checked');
    var name = $("#feedbackName").value.trim();
    var message = $("#feedbackMessage").value.trim();
    var l = ["Hello MISO, I would like to share feedback."];
    if (rating) l.push("Rating: " + rating.value);
    if (name) l.push("Name: " + name);
    l.push("");
    l.push(message);
    return l.join("\n");
  }

  /* ------------------------------------------------------------------ */
  /* toast                                                               */
  /* ------------------------------------------------------------------ */

  var toastTimer;
  function showToast(text, icon) {
    var toast = $("#toast");
    toast.innerHTML = (icon ? svgIcon(icon) : "") + "<span>" + escapeHtml(text) + "</span>";
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-visible"); }, 2600);
  }

  /* ------------------------------------------------------------------ */
  /* scroll reveals & category tracking                                  */
  /* ------------------------------------------------------------------ */

  var revealObserver = null;
  function initReveals() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var nodes = $$("[data-reveal]:not(.is-visible)");
    if (reduce || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-visible"); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    }
    nodes.forEach(function (n) { revealObserver.observe(n); });
  }

  function menuOffset() {
    var header = $("#siteHeader");
    var toolbar = $("#menuToolbar");
    return (header ? header.offsetHeight : 78) + (toolbar ? toolbar.offsetHeight : 62) + 12;
  }

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    $("#siteHeader").classList.toggle("is-scrolled", y > 24);

    var offset = menuOffset();
    var active = null;
    MENU.forEach(function (cat) {
      var section = $("#menu-" + cat.id);
      if (!section || section.hidden) return;
      if (section.getBoundingClientRect().top - offset <= 0) active = cat.id;
    });
    if (!active) {
      var firstVisible = MENU.filter(function (c) {
        var s = $("#menu-" + c.id);
        return s && !s.hidden;
      })[0];
      active = firstVisible ? firstVisible.id : null;
    }
    $$(".menu-tab").forEach(function (tab) {
      tab.classList.toggle("is-active", tab.getAttribute("data-tab") === active);
    });
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */

  var navOpen = false;

  function init() {
    renderSignatures();
    renderMenu();
    renderCart();
    initReveals();
    onScroll();

    $("#footerYear").textContent = String(new Date().getFullYear());

    /* config-driven links */
    $("#menuAskLink").href = waLink(CFG.whatsapp.waiter, "Hello MISO, I have a question about your menu:");
    $("#visitWhatsapp").href = waLink(CFG.whatsapp.waiter, "Hello MISO, I would like to ask about a table / order:");

    /* header */
    var navToggle = $("#navToggle");
    navToggle.addEventListener("click", function () {
      navOpen = !navOpen;
      $("#siteNav").classList.toggle("is-open", navOpen);
      navToggle.setAttribute("aria-expanded", String(navOpen));
      navToggle.setAttribute("aria-label", navOpen ? "Close menu" : "Open menu");
    });
    $$("#siteNav a").forEach(function (link) {
      link.addEventListener("click", function () {
        navOpen = false;
        $("#siteNav").classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });

    $("#cartTrigger").addEventListener("click", openCart);
    $("#orderBarButton").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#drawerBackdrop").addEventListener("click", closeCart);
    $("#cartBrowse").addEventListener("click", function () {
      closeCart();
      smoothScrollTo($("#menu"));
    });
    $("#checkoutStart").addEventListener("click", openCheckout);

    /* add to cart / ask (delegated) */
    document.addEventListener("click", function (event) {
      var feedbackTrigger = event.target.closest("[data-feedback]");
      if (feedbackTrigger) {
        event.preventDefault();
        openFeedback(feedbackTrigger);
        return;
      }

      var add = event.target.closest("[data-add]");
      if (add) {
        event.preventDefault();
        addToCart(add.getAttribute("data-add"));
        if (add.classList.contains("item-add")) {
          add.classList.add("is-added");
          add.innerHTML = svgIcon("i-check");
          setTimeout(function () {
            add.classList.remove("is-added");
            add.innerHTML = svgIcon("i-plus");
          }, 1100);
        }
        return;
      }

      var inc = event.target.closest("[data-inc]");
      if (inc) {
        var id = inc.getAttribute("data-inc");
        cart.forEach(function (line) { if (line.id === id) line.qty = Math.min(line.qty + 1, CFG.order.maxQuantity); });
        writeCart();
        renderCart();
        return;
      }
      var dec = event.target.closest("[data-dec]");
      if (dec) {
        var id2 = dec.getAttribute("data-dec");
        var line2 = null;
        cart.forEach(function (l) { if (l.id === id2) line2 = l; });
        setQty(id2, line2 ? line2.qty - 1 : 0);
        return;
      }
      var remove = event.target.closest("[data-remove]");
      if (remove) {
        var removed = ITEMS[remove.getAttribute("data-remove")];
        setQty(remove.getAttribute("data-remove"), 0);
        if (removed) showToast(removed.name + " removed", "i-trash");
        return;
      }

      var noteToggle = event.target.closest("[data-note-toggle]");
      if (noteToggle) {
        var targetId = noteToggle.getAttribute("data-note-toggle");
        var field = $('[data-note-field="' + targetId + '"]');
        if (field) {
          field.hidden = false;
          var input = $("input", field);
          if (input) input.focus();
        }
        return;
      }

      var copy = event.target.closest("[data-copy-target]");
      if (copy) {
        var source = $("#" + copy.getAttribute("data-copy-target"));
        if (source) {
          copyText(source.textContent.trim(), labelFor(copy));
          copy.classList.add("is-copied");
          var label = $("span", copy);
          if (label) {
            label.textContent = "Copied";
            setTimeout(function () { label.textContent = "Copy"; copy.classList.remove("is-copied"); }, 1600);
          }
        }
        return;
      }

      var lightboxTrigger = event.target.closest("[data-lightbox]");
      if (lightboxTrigger) {
        openLightbox(lightboxTrigger);
        return;
      }

      var tab = event.target.closest("[data-tab]");
      if (tab) {
        smoothScrollTo($("#menu-" + tab.getAttribute("data-tab")));
      }
    });

    /* cart notes */
    $("#cartLines").addEventListener("input", function (event) {
      var input = event.target.closest("[data-note-input]");
      if (!input) return;
      var id = input.getAttribute("data-note-input");
      setNote(id, input.value);
      var row = input.closest(".cart-line");
      var toggle = row ? $('[data-note-toggle="' + id + '"]', row) : null;
      if (toggle) toggle.textContent = input.value.trim() ? "Edit note" : "Add a note";
    });

    /* menu controls */
    var search = $("#menuSearch");
    search.addEventListener("input", debounce(applyFilters, 140));
    search.addEventListener("search", applyFilters);
    $("#menuFilter").addEventListener("change", applyFilters);

    /* checkout */
    $("#checkoutClose").addEventListener("click", function () { closeCheckout(false); });
    $("#checkoutBackdrop").addEventListener("click", function () { closeCheckout(false); });
    $("#paymentBack").addEventListener("click", function () { goStep(1); renderSummary(); });
    $("#paymentContinue").addEventListener("click", finishOrder);
    $("#finishCheckout").addEventListener("click", function () {
      closeCheckout(true);
      $("#detailsForm").reset();
      RULES.forEach(function (rule) { clearError(rule.id); });
      setServicePanels(currentService());
      goStep(1);
      renderSummary();
    });
    $("#copySummary").addEventListener("click", function () {
      if (activeOrder) copyText(orderText(activeOrder), "Order summary");
    });
    $("#transferConfirm").addEventListener("change", function (event) {
      $("#paymentContinue").disabled = !event.target.checked;
    });

    $$('input[name=service]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        setServicePanels(radio.value);
        RULES.forEach(function (rule) { clearError(rule.id); });
      });
    });
    ["#tableNumber", "#pickupTime"].forEach(function (sel) {
      var el = $(sel);
      var handler = function () {
        clearError(el.id);
        renderSummary();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    $("#detailsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      if (!cart.length) {
        showToast("Add at least one dish first", "i-close");
        return;
      }
      if (!validateForm()) return;
      toPayment();
    });

    /* lightbox */
    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxPrev").addEventListener("click", function () { stepLightbox(-1); });
    $("#lightboxNext").addEventListener("click", function () { stepLightbox(1); });
    $("#lightbox").addEventListener("click", function (event) {
      if (event.target === $("#lightbox")) closeLightbox();
    });

    /* feedback */
    $("#feedbackClose").addEventListener("click", closeFeedback);
    $("#feedbackBackdrop").addEventListener("click", closeFeedback);
    $("#feedbackForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var message = $("#feedbackMessage").value.trim();
      if (message.length < 3) {
        $("#feedbackMessage").setAttribute("aria-invalid", "true");
        $('[data-error-for="feedbackMessage"]').textContent = "Write a short message first.";
        $("#feedbackMessage").focus();
        showToast("Write a short message first", "i-close");
        return;
      }
      clearError("feedbackMessage");
      var link = document.createElement("a");
      link.href = waLink(CFG.whatsapp.waiter, feedbackText());
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("WhatsApp opened — tap send there", "i-whatsapp");
      closeFeedback();
    });

    /* keyboard */
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        var top = Layer.top();
        if (top) {
          if (top.el === $("#lightbox")) closeLightbox();
          else if (top.el === $("#checkout")) closeCheckout(false);
          else if (top.el === $("#feedback")) closeFeedback();
          else closeCart();
          return;
        }
        if (navOpen) {
          navOpen = false;
          $("#siteNav").classList.remove("is-open");
          navToggle.setAttribute("aria-expanded", "false");
        }
        return;
      }
      if (event.key === "Tab" && Layer.top()) {
        trapTab(event);
        return;
      }
      if (lightboxState.entry) {
        if (event.key === "ArrowLeft") stepLightbox(-1);
        if (event.key === "ArrowRight") stepLightbox(1);
      }
    });

    setServicePanels(currentService());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", debounce(onScroll, 150));
    window.addEventListener("online", flushOutbox);
    flushOutbox();
    initWebApp();
    initInstallButton();
  }

  /* ------------------------------------------------------------------ */
  /* installable web app                                                 */
  /* ------------------------------------------------------------------ */

  function initWebApp() {
    var secure = location.protocol === "https:" ||
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!secure || !("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        /* preview servers and older browsers simply skip the offline cache */
      });
    });
  }

  function initInstallButton() {
    var button = $("#installApp");
    if (!button) return;

    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
    if (standalone) return;

    var promptEvent = null;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !/crios|fxios|edgios|opios/i.test(navigator.userAgent);

    if (ios) {
      // iOS has no install prompt; point at Safari's Share sheet instead.
      button.hidden = false;
      button.addEventListener("click", function () {
        showToast("Tap Share, then “Add to Home Screen”", "i-arrow-up");
      });
    }

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      promptEvent = event;
      button.hidden = false;
    });

    button.addEventListener("click", function () {
      if (!promptEvent) return;
      promptEvent.prompt();
      promptEvent.userChoice.then(function () {
        promptEvent = null;
        button.hidden = true;
      });
    });

    window.addEventListener("appinstalled", function () {
      promptEvent = null;
      button.hidden = true;
    });
  }

  function labelFor(button) {
    var target = button.getAttribute("data-copy-target");
    if (target === "bankReference" || target === "confirmReference") return "Reference";
    if (target === "bankAmount") return "Amount";
    if (target === "bankName") return "Bank name";
    if (target === "bankAccountName") return "Account name";
    return "Account number";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
