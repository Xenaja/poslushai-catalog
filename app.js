/* Каталог «Послушай» — мини-приложение Телеграма и ВК, работает и в браузере.
   Данные — window.CATALOG из data.js (собирает bot/tools/build_catalog.py).

   Оформление заказа:
   • Телеграм — ссылка в бот с корзиной в start-параметре (o_1m2-6m5x2-s1-n[_p]);
     бот сразу открывает оформление с этим списком.
   • ВК и браузер — текст заказа копируется, открывается чат сообщества;
     бот узнаёт строку «Заказ из каталога: …». */
(function () {
  "use strict";
  var C = window.CATALOG;
  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var params = new URLSearchParams(location.search);
  var inVK = params.has("vk_platform") || /vk\.com|vk\.ru/.test(document.referrer);

  // ---------- состояние
  var STORE = "poslushai-cart-v1";
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* приватный режим */ } }

  var startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
  var isPromo = !!C.promo && (params.get("promo") === "1" || startParam === "promo" || load("poslushai-promo", false));
  if (isPromo) save("poslushai-promo", true);

  // Позиция корзины: {id, kind: "p"|"s"|"n", n, ml, q}
  var cart = load(STORE, []).filter(valid);
  function valid(it) {
    if (it.kind === "p") { var p = perfume(it.n); return p && p.inStock && p.prices.some(function (x) { return x.ml === it.ml; }); }
    if (it.kind === "s") { var s = spray(it.n); return s && s.inStock; }
    if (it.kind === "n") return !!(C.promo && C.promo.set);
    return false;
  }

  function perfume(n) { return C.perfumes.filter(function (p) { return p.n === n; })[0]; }
  function spray(n) { return C.sprays.filter(function (s) { return s.n === n; })[0]; }

  // ---------- утилиты
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function rub(n) { return n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₽"; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function minPrice(prices) {
    var nums = prices.map(function (p) { return p.p; }).filter(function (x) { return x != null; });
    if (!nums.length) return prices.length ? prices[0].label : "";
    var min = Math.min.apply(null, nums);
    return (prices.length > 1 ? "от " : "") + rub(min);
  }
  function haptic(kind) { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind || "light"); } catch (e) { /* нет */ } }
  var toastTimer;
  function toast(text) {
    var t = document.getElementById("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- корзина: строки, суммы, код для бота
  function lineInfo(it) {
    if (it.kind === "p") {
      var p = perfume(it.n), pr = p.prices.filter(function (x) { return x.ml === it.ml; })[0];
      return { name: "«" + p.title + "»", meta: pr.v, price: pr.p, label: pr.label };
    }
    if (it.kind === "s") {
      var s = spray(it.n), sp = s.prices[0] || { v: "", p: null, label: "по запросу" };
      return { name: "Спрей «" + s.title + "»", meta: sp.v, price: sp.p, label: sp.label };
    }
    var set = C.promo.set, promo = isPromo && set.promoPrice != null;
    return { name: "Набор «" + set.title + "»", meta: "3 × 2 мл" + (promo ? " · по промокоду" : ""),
      price: promo ? set.promoPrice : set.price, label: promo ? set.promoLabel : set.label };
  }
  function totals() {
    var sum = 0, open = false, count = 0;
    cart.forEach(function (it) {
      var li = lineInfo(it); count += it.q;
      if (li.price == null) open = true; else sum += li.price * it.q;
    });
    return { sum: sum, open: open, count: count };
  }
  function cartCode() {
    return cart.map(function (it) {
      var code = it.kind === "p" ? it.n + "m" + it.ml : it.kind === "s" ? "s" + it.n : "n";
      return code + (it.q > 1 ? "x" + it.q : "");
    }).join("-");
  }
  function cartText() {
    var t = totals();
    var lines = cart.map(function (it) {
      var li = lineInfo(it);
      return li.name + " " + li.meta + (it.q > 1 ? " ×" + it.q : "");
    });
    var s = "Заказ из каталога: " + lines.join(", ") + ". Итого " + rub(t.sum) + (t.open ? " + позиции по запросу" : "");
    if (isPromo && C.promo) s += ". Промокод " + C.promo.code;
    return s;
  }

  function add(item) {
    var same = cart.filter(function (it) { return it.kind === item.kind && it.n === item.n && it.ml === item.ml; })[0];
    if (same) same.q += 1; else cart.push(Object.assign({ q: 1 }, item));
    save(STORE, cart); renderBar(); haptic("medium");
  }
  function setQty(it, q) {
    if (q <= 0) cart.splice(cart.indexOf(it), 1); else it.q = Math.min(q, 9);
    save(STORE, cart); renderBar();
  }

  // ---------- оформление
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = el("textarea", { readonly: true, style: "position:fixed;opacity:0" });
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* не вышло — текст останется на экране */ }
    ta.remove();
  }
  function tgLink(payload) { return "https://t.me/" + C.bot + (payload ? "?start=" + payload : ""); }
  function checkoutTelegram() {
    var payload = "o_" + cartCode() + (isPromo ? "_p" : "");
    // В start-параметре — до 64 знаков; длинную корзину отправим текстом.
    if (payload.length > 64) payload = "o_" + (isPromo ? "_p" : "");
    var url = tgLink(payload);
    if (inTelegram) { tg.openTelegramLink(url); setTimeout(function () { tg.close(); }, 300); }
    else window.open(url, "_blank");
  }
  function checkoutVK() {
    copy(cartText()).then(function () {
      toast("Заказ скопирован — вставьте его в чат");
      setTimeout(function () { window.open(C.vk, "_blank"); }, 700);
    });
  }

  // ---------- отрисовка: предложение
  function setPrice(set) {
    var box = el("span", { class: "promo__price" });
    if (set.promoPrice == null || set.promoPrice === set.price) { box.textContent = set.label; return box; }
    if (isPromo) {
      box.appendChild(el("s", { class: "promo__old", text: set.label }));
      box.appendChild(document.createTextNode(" " + set.promoLabel));
    } else {
      box.appendChild(document.createTextNode(set.label));
      box.appendChild(el("span", { class: "promo__alt", text: "по промокоду — " + set.promoLabel }));
    }
    return box;
  }
  function renderPromo() {
    var box = document.getElementById("promo");
    if (!C.promo || !C.promo.set) return;
    var set = C.promo.set;
    box.hidden = false;
    var perks = el("ul", { class: "promo__perks" }, [
      el("li", {}, isPromo
        ? ["Скидка 15% на любой заказ по промокоду", el("span", { class: "promo__code", text: C.promo.code })]
        : ["Скидка 15% для участников розыгрыша — промокод в боте"]),
      C.promo.deliveryFrom ? el("li", { text: "Бесплатная доставка до ПВЗ при заказе от " + C.promo.deliveryFrom + " ₽" }) : null,
      C.promo.until ? el("li", { text: "До " + C.promo.until }) : null,
    ]);
    box.appendChild(el("p", { class: "label", text: "Для участников розыгрыша" }));
    box.appendChild(el("h2", { class: "promo__title", text: set.title }));
    box.appendChild(el("p", { class: "promo__sub", text: set.subtitle }));
    box.appendChild(el("div", { class: "promo__items" }, set.items.map(function (t) { return el("span", { text: t }); })));
    box.appendChild(el("p", { class: "promo__text", text: set.text.split("\n\n")[0] }));
    box.appendChild(perks);
    box.appendChild(el("div", { class: "promo__row" }, [
      setPrice(set),
      el("button", { class: "btn btn--light", type: "button", text: "В корзину", onclick: function () { add({ kind: "n", n: 0, ml: 0 }); toast("Набор в корзине"); } }),
    ]));
  }

  // ---------- отрисовка: плитки
  var family = "";
  function renderFilters() {
    var box = document.getElementById("filters");
    var fams = [];
    C.perfumes.forEach(function (p) { if (p.family && fams.indexOf(p.family) < 0) fams.push(p.family); });
    if (fams.length < 2) { box.hidden = true; return; }
    box.innerHTML = "";
    [""].concat(fams).forEach(function (f) {
      box.appendChild(el("button", { class: "filter", type: "button", "aria-pressed": f === family ? "true" : "false", text: f || "Все",
        onclick: function () { family = f; renderFilters(); renderPerfumes(); } }));
    });
  }
  function renderPerfumes() {
    var grid = document.getElementById("perfumeGrid");
    grid.innerHTML = "";
    var list = C.perfumes.filter(function (p) { return !family || p.family === family; });
    document.getElementById("perfumesCount").textContent = list.length + " " + plural(list.length, "аромат", "аромата", "ароматов");
    list.forEach(function (p) {
      grid.appendChild(el("button", { class: "tile" + (p.inStock ? "" : " is-out"), type: "button", onclick: function () { openPerfume(p); } }, [
        el("div", { class: "tile__img" }, [
          p.img ? el("img", { src: p.img, alt: "", loading: "lazy", decoding: "async" }) : null,
          el("span", { class: "tile__num", text: "№" + pad(p.n) }),
          p.inStock ? null : el("span", { class: "tile__badge", text: "нет в наличии" }),
        ]),
        p.family ? el("p", { class: "tile__family", text: p.family }) : null,
        el("div", { class: "tile__title", text: p.title }),
        el("p", { class: "tile__tag", text: p.tagline || p.about }),
        el("div", { class: "tile__price", text: minPrice(p.prices) }),
      ]));
    });
  }
  function glyph(s) {
    var m = (s.subtitle || "").match(/^([　-鿿]+)/);
    if (m) return { text: m[1], word: false };
    if (s.key === "kokoro") return { text: "心", word: false };
    return { text: s.title, word: true };
  }
  function renderSprays() {
    var grid = document.getElementById("sprayGrid");
    if (!C.sprays.length) { document.getElementById("sprays").hidden = true; return; }
    var intro = document.getElementById("spraysIntro");
    if (C.info.sprays_intro) intro.textContent = C.info.sprays_intro; else intro.hidden = true;
    C.sprays.forEach(function (s) {
      var g = glyph(s);
      grid.appendChild(el("button", { class: "tile" + (s.inStock ? "" : " is-out"), type: "button", onclick: function () { openSpray(s); } }, [
        s.img ? el("div", { class: "tile__img" }, [el("img", { src: s.img, alt: "", loading: "lazy" })])
              : el("div", { class: "tile__glyph" + (g.word ? " is-word" : ""), "aria-hidden": "true" }, [el("span", { text: g.text })]),
        s.family ? el("p", { class: "tile__family", text: s.family }) : null,
        el("div", { class: "tile__title", text: s.title }),
        el("p", { class: "tile__tag", text: (s.subtitle || "").replace(/^[　-鿿]+\s*—\s*/, "") || "Спрей для дома и тела" }),
        el("div", { class: "tile__price", text: s.prices.map(function (x) { return x.v; }).join(" · ") + (minPrice(s.prices) ? " · " + minPrice(s.prices) : "") }),
      ]));
    });
  }
  function renderInfo() {
    var list = document.getElementById("infoList");
    [
      ["Доставка и подарки", C.info.perks],
      ["О составе", C.info.composition],
      ["Как пользоваться масляными духами", C.info.oils_howto],
      ["Как пользоваться спреями", C.info.sprays_howto],
    ].forEach(function (row) {
      if (!row[1]) return;
      list.appendChild(el("details", {}, [el("summary", { text: row[0] }), el("div", { class: "acc__body", text: row[1] })]));
    });
  }

  // ---------- шторка
  var sheet = document.getElementById("sheet"), body = document.getElementById("sheetBody");
  function openSheet(nodes) {
    body.innerHTML = ""; nodes.forEach(function (n) { if (n) body.appendChild(n); });
    body.scrollTop = 0; sheet.hidden = false; document.body.classList.add("locked");
    if (tg && tg.BackButton) tg.BackButton.show();
  }
  function closeSheet() {
    sheet.hidden = true; document.body.classList.remove("locked");
    if (tg && tg.BackButton) tg.BackButton.hide();
  }
  sheet.addEventListener("click", function (e) { if (e.target.hasAttribute("data-close")) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
  if (tg && tg.BackButton) tg.BackButton.onClick(closeSheet);

  function notesBlock(n) {
    var cols = [["Верхние ноты", n.top], ["Сердце", n.heart], ["База", n.base]].filter(function (c) { return c[1]; });
    if (!cols.length) return null;
    return el("div", { class: "notes" }, cols.map(function (c) {
      return el("div", {}, [el("h4", { text: c[0] }), el("p", { text: c[1].split(", ").join("\n") })]);
    }));
  }
  function notesFromText(text) {
    var n = {};
    (text || "").split("\n").forEach(function (line) {
      var m = line.match(/^(Верхние ноты|Сердце|База):\s*(.+)$/i);
      if (m) n[{ "верхние ноты": "top", "сердце": "heart", "база": "base" }[m[1].toLowerCase()]] = m[2];
    });
    return n;
  }

  function buyBlock(item, prices, kind) {
    if (!item.inStock) {
      return el("div", {}, [
        el("p", { class: "pd__out", text: "Сейчас закончился. Напишите нам — сообщим, когда появится." }),
        el("div", { class: "pd__actions" }, [
          el("button", { class: "btn btn--ghost", type: "button", text: "Сообщить о поступлении", onclick: function () {
            var code = kind === "p" ? item.n + "m" + prices[0].ml : "s" + item.n;
            if (inTelegram || !inVK) { var url = tgLink("o_" + code); inTelegram ? tg.openTelegramLink(url) : window.open(url, "_blank"); }
            else copy("Заказ из каталога: «" + item.title + "» — сообщить о поступлении").then(function () { toast("Текст скопирован — вставьте его в чат"); setTimeout(function () { window.open(C.vk, "_blank"); }, 700); });
          } }),
        ]),
      ]);
    }
    var chosen = prices[prices.length > 1 ? 1 : 0];
    var chips = el("div", { class: "chips", role: "group", "aria-label": "Объём" });
    prices.forEach(function (pr) {
      chips.appendChild(el("button", { class: "chip", type: "button", "aria-pressed": pr === chosen ? "true" : "false", onclick: function (e) {
        chosen = pr;
        Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute("aria-pressed", "false"); });
        e.currentTarget.setAttribute("aria-pressed", "true");
      } }, [el("b", { text: pr.v }), pr.label]));
    });
    return el("div", {}, [
      el("p", { class: "label", text: prices.length > 1 ? "Объём" : "Цена" }),
      chips,
      el("div", { class: "pd__actions" }, [
        el("button", { class: "btn", type: "button", text: "Добавить в корзину", onclick: function () {
          add({ kind: kind, n: item.n, ml: kind === "p" ? chosen.ml : 0 });
          toast("«" + item.title + "» " + chosen.v + " — в корзине");
          closeSheet();
        } }),
      ]),
    ]);
  }

  function openPerfume(p) {
    openSheet([
      p.img ? el("div", { class: "pd__img" }, [el("img", { src: p.img, alt: "Метафорическая карта аромата «" + p.title + "»" })]) : null,
      el("div", { class: "pd" }, [
        el("p", { class: "label", text: "Масляные духи · №" + pad(p.n) + (p.family ? " · " + p.family : "") }),
        el("h2", { class: "pd__title", text: p.title }),
        p.tagline ? el("p", { class: "pd__tag", text: p.tagline }) : null,
        p.smell ? el("p", { class: "pd__text", text: p.smell }) : null,
        notesBlock(p.notes),
        p.about ? el("p", { class: "pd__text pd__muted", text: p.about }) : null,
        p.effect ? el("div", { class: "pd__effect" }, [el("p", { class: "label", text: "Эффект" }), el("p", { text: p.effect.charAt(0).toUpperCase() + p.effect.slice(1) })]) : null,
        buyBlock(p, p.prices, "p"),
        el("p", { class: "pd__hint", text: "Трек и карту к аромату пришлёт бот" }),
      ]),
    ]);
  }
  function openSpray(s) {
    var g = glyph(s);
    openSheet([
      s.img ? el("div", { class: "pd__img" }, [el("img", { src: s.img, alt: "" })]) : el("div", { class: "pd__glyph", "aria-hidden": "true", text: g.word ? "" : g.text }),
      el("div", { class: "pd" }, [
        el("p", { class: "label", text: "Спрей для дома и тела" }),
        el("h2", { class: "pd__title", text: s.title }),
        s.subtitle ? el("p", { class: "pd__tag", text: s.subtitle }) : null,
        s.smell ? el("p", { class: "pd__text", text: s.smell }) : null,
        notesBlock(notesFromText(s.notes)),
        s.effect ? el("div", { class: "pd__effect" }, [el("p", { class: "label", text: "Эффект" }), el("p", { text: s.effect })]) : null,
        buyBlock(s, s.prices, "s"),
      ]),
    ]);
  }

  function openCart() {
    var t = totals();
    var nodes = [el("h2", { class: "cart__title", text: "Корзина" })];
    if (!cart.length) {
      nodes.push(el("p", { class: "cart__empty", text: "Пока пусто. Выберите аромат — и он появится здесь." }));
      openSheet([el("div", { class: "cart" }, nodes)]);
      return;
    }
    cart.forEach(function (it) {
      var li = lineInfo(it);
      nodes.push(el("div", { class: "line" }, [
        el("div", {}, [el("div", { class: "line__name", text: li.name }), el("div", { class: "line__meta", text: li.meta + " · " + li.label })]),
        el("div", { class: "line__sum", text: li.price != null ? rub(li.price * it.q) : "по запросу" }),
        el("div", { class: "qty" }, [
          el("button", { type: "button", "aria-label": "Меньше", text: "−", onclick: function () { setQty(it, it.q - 1); openCart(); } }),
          el("span", { text: String(it.q) }),
          el("button", { type: "button", "aria-label": "Больше", text: "+", onclick: function () { setQty(it, it.q + 1); openCart(); } }),
        ]),
      ]));
    });
    nodes.push(el("div", { class: "cart__total" }, [el("span", { text: "Итого" }), el("b", { text: rub(t.sum) + (t.open ? " +" : "") })]));
    var note = [];
    if (isPromo && C.promo) {
      var hasSet = cart.some(function (it) { return it.kind === "n"; });
      note.push("Промокод " + C.promo.code + ": −15% на духи и спреи учтём при оформлении" + (hasSet ? " (набор уже по цене промокода)" : "") + "." +
        (C.promo.deliveryFrom ? " Доставка до ПВЗ бесплатно от " + C.promo.deliveryFrom + " ₽." : ""));
    }
    if (t.open) note.push("У части позиций цена по запросу — менеджер подтвердит итог.");
    note.push("Оформление — в чате с ботом: имя, телефон и пункт выдачи. Ответим там же.");
    nodes.push(el("p", { class: "cart__note", text: note.join("\n") }));
    var actions = el("div", { class: "pd__actions" });
    if (inTelegram) actions.appendChild(el("button", { class: "btn", type: "button", text: "Оформить в боте", onclick: checkoutTelegram }));
    else if (inVK) actions.appendChild(el("button", { class: "btn", type: "button", text: "Оформить в чате ВК", onclick: checkoutVK }));
    else {
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Оформить в Телеграме", onclick: checkoutTelegram }));
      actions.appendChild(el("button", { class: "btn btn--ghost", type: "button", text: "Оформить во ВКонтакте", onclick: checkoutVK }));
    }
    nodes.push(actions);
    openSheet([el("div", { class: "cart" }, nodes)]);
  }

  function renderBar() {
    var t = totals();
    document.getElementById("cartCount").textContent = "(" + t.count + ")";
    var bar = document.getElementById("bar");
    bar.hidden = !t.count;
    document.getElementById("barText").textContent = t.count + " · " + rub(t.sum) + (t.open ? " +" : "");
  }

  // ---------- старт
  document.getElementById("cartOpen").addEventListener("click", openCart);
  document.getElementById("barBtn").addEventListener("click", openCart);
  document.getElementById("tgLink").href = tgLink("");
  document.getElementById("vkLink").href = C.vk;
  if (C.policy) { var pl = document.getElementById("policyLink"); pl.href = C.policy; pl.hidden = false; }

  renderPromo(); renderFilters(); renderPerfumes(); renderSprays(); renderInfo(); renderBar();

  if (tg) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor && tg.setHeaderColor("#ece7df");
      tg.setBackgroundColor && tg.setBackgroundColor("#ece7df");
    } catch (e) { /* старый клиент */ }
  }
})();
