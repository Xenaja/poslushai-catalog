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
  // Промо-часть (промокод, цена набора по коду, доставка) — только участникам:
  // пришёл по промо-ссылке (?promo=1) или ввёл код. Помним до закрытия
  // каталога (sessionStorage), а не навсегда: иначе её видел бы каждый,
  // кто однажды открыл промо-ссылку (решено 11.11).
  function sessionFlag(v) {
    try { if (v) sessionStorage.setItem("poslushai-promo", "1"); return sessionStorage.getItem("poslushai-promo") === "1"; }
    catch (e) { return !!v; }
  }
  try { localStorage.removeItem("poslushai-promo"); } catch (e) { /* старая бессрочная отметка */ }
  var isPromo = !!C.promo && sessionFlag(params.get("promo") === "1" || startParam === "promo");

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
  // Неразрывные пробелы: «1 950 ₽» не рвётся переносом.
  function rub(n) { return n.toLocaleString("ru-RU").replace(/\s/g, " ") + " ₽"; }
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
    // «3 роллера по 2 мл», а не «3 × 2 мл»: бот читает «×N» как количество.
    return { name: "Набор «" + set.title + "»" + swapLabel(it.sw), meta: "3 роллера по 2 мл", set: true,
      price: promo ? set.promoPrice : set.price, label: promo ? set.promoLabel + " по промокоду" : set.label };
  }
  // Сумма строки. С промокодом: духи и спреи −discount%, набор — по своей цене.
  // Округление до рубля как в боте (552,5 → 553), чтобы суммы совпадали.
  function lineSum(it) {
    var li = lineInfo(it);
    if (li.price == null) return null;
    var off = isPromo && C.promo && C.promo.discount && !li.set ? (100 - C.promo.discount) / 100 : 1;
    return Math.floor(li.price * it.q * off + 0.5);
  }
  // Без скидки: набор — по обычной цене (как в боте).
  function fullSum(it) {
    var li = lineInfo(it);
    if (li.price == null) return null;
    return (li.set && C.promo.set.price != null ? C.promo.set.price : li.price) * it.q;
  }
  function totals() {
    var sum = 0, full = 0, open = false, count = 0;
    cart.forEach(function (it) {
      var ls = lineSum(it), fs = fullSum(it); count += it.q;
      if (ls == null) open = true; else { sum += ls; full += fs; }
    });
    return { sum: sum, full: full, open: open, count: count };
  }
  function cartCode() {
    return cart.map(function (it) {
      var code = it.kind === "p" ? it.n + "m" + it.ml : it.kind === "s" ? "s" + it.n : "n" + (it.sw ? "w" + it.sw : "");
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
    var same = cart.filter(function (it) { return it.kind === item.kind && it.n === item.n && it.ml === item.ml && (it.sw || "") === (item.sw || ""); })[0];
    if (same) same.q += 1; else cart.push(Object.assign({ q: 1 }, item));
    save(STORE, cart); renderBar(); haptic("medium");
  }
  function setQty(it, q) {
    if (q <= 0) cart.splice(cart.indexOf(it), 1); else it.q = Math.min(q, 9);
    save(STORE, cart); renderBar();
  }

  // Замена в наборе: sw = "3t1" — №3 заменить на №1.
  function swapLabel(sw) {
    var m = /^(\d+)t(\d+)$/.exec(sw || "");
    if (!m) return "";
    var a = perfume(+m[1]), b = perfume(+m[2]);
    return a && b ? " (" + a.title + " → " + b.title + ")" : "";
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
  // Цена набора. Всем — обычная цена и сравнение «по отдельности»;
  // участнику (промо-ссылка или введённый код) — цена по промокоду.
  function setPrice(set) {
    var box = el("span", { class: "promo__price" });
    var promo = isPromo && set.promoPrice != null && set.promoPrice !== set.price;
    var now = promo ? set.promoPrice : set.price;
    function fmt(n, label) { return n != null ? rub(n) : label; }
    if (promo) box.appendChild(el("s", { class: "promo__old", text: fmt(set.price, set.label) }));
    box.appendChild(el("span", { class: "promo__now", text: promo ? fmt(set.promoPrice, set.promoLabel) : fmt(set.price, set.label) }));
    if (set.separate && now != null && set.separate > now) {
      box.appendChild(el("span", { class: "promo__alt", text: "3 роллера по отдельности — " + rub(set.separate) }));
      box.appendChild(el("span", { class: "promo__save", text: "выгода " + rub(set.separate - now) }));
    }
    return box;
  }
  // Набор видят все («Предложение ноября»). Скидку по коду, доставку и сам
  // код — только участники розыгрыша (решено 10.11).
  function renderPromo() {
    var box = document.getElementById("promo");
    box.innerHTML = "";
    if (!C.promo || !C.promo.set) { box.hidden = true; return; }
    var set = C.promo.set;
    box.hidden = false;
    var perks = isPromo ? el("ul", { class: "promo__perks" }, [
      el("li", {}, ["Скидка 15% на любой заказ по промокоду", el("span", { class: "promo__code", text: C.promo.code })]),
      C.promo.deliveryFrom ? el("li", { text: "Бесплатная доставка до ПВЗ при заказе от " + C.promo.deliveryFrom + " ₽" }) : null,
      C.promo.until ? el("li", { text: "До " + C.promo.until }) : null,
    ]) : null;
    if (set.img) box.appendChild(el("div", { class: "promo__img" }, [el("img", { src: set.img, alt: "Набор «" + set.title + "»: " + set.items.join(", "), loading: "lazy" })]));
    box.appendChild(el("p", { class: "label", text: isPromo ? "Для участников розыгрыша" : (set.badge || "Специальное предложение") }));
    box.appendChild(el("h2", { class: "promo__title", text: set.title }));
    box.appendChild(el("p", { class: "promo__sub", text: set.subtitle }));
    box.appendChild(el("div", { class: "promo__items" }, set.items.map(function (t) { return el("span", { text: t }); })));
    box.appendChild(el("p", { class: "promo__text", text: set.text.split("\n\n")[0] }));
    if (perks) box.appendChild(perks);
    var swap = swapBlock(set);
    if (swap.node) box.appendChild(swap.node);
    box.appendChild(el("div", { class: "promo__row" }, [
      setPrice(set),
      el("button", { class: "btn btn--light", type: "button", text: "В корзину", onclick: function () {
        var sw = swap.value();
        add({ kind: "n", n: 0, ml: 0, sw: sw });
        toast("Набор в корзине" + swapLabel(sw));
      } }),
    ]));
  }

  // «Можно поменять один аромат в наборе на другой из каталога» (11.11)
  function swapBlock(set) {
    var ns = set.itemNs || [];
    var others = C.perfumes.filter(function (p) { return p.inStock && ns.indexOf(p.n) < 0; });
    if (!set.swapNote || !ns.length || !others.length) return { node: null, value: function () { return ""; } };
    var from = el("select", { class: "swap__select", "aria-label": "Какой аромат заменить" },
      [el("option", { value: "", text: "Без замены" })].concat(ns.map(function (n) { return el("option", { value: String(n), text: "Заменить «" + perfume(n).title + "»" }); })));
    var to = el("select", { class: "swap__select", "aria-label": "На какой аромат", disabled: true },
      others.map(function (p) { return el("option", { value: String(p.n), text: "на «" + p.title + "»" }); }));
    from.addEventListener("change", function () { to.disabled = !from.value; });
    var node = el("div", { class: "swap" }, [
      el("p", { class: "swap__note", text: set.swapNote }),
      el("div", { class: "swap__row" }, [from, to]),
    ]);
    return { node: node, value: function () { return from.value ? from.value + "t" + to.value : ""; } };
  }

  // ---------- отрисовка: плитки
  // Фильтр по семействам: у аромата их может быть несколько, фильтр
  // действует и на духи, и на спреи (11.11).
  var family = "";
  function fams(x) { return x.families || []; }
  function matches(x) { return !family || fams(x).indexOf(family) >= 0; }
  function renderFilters() {
    var box = document.getElementById("filters");
    var all = (C.familyOrder || []).slice();
    C.perfumes.concat(C.sprays).forEach(function (x) { fams(x).forEach(function (f) { if (all.indexOf(f) < 0) all.push(f); }); });
    if (all.length < 2) { box.hidden = true; return; }
    box.innerHTML = "";
    [""].concat(all).forEach(function (f) {
      box.appendChild(el("button", { class: "filter", type: "button", "aria-pressed": f === family ? "true" : "false", text: f || "Все",
        onclick: function () { family = f; renderFilters(); renderPerfumes(); renderSprays(); } }));
    });
  }
  function noPhoto(x) {
    return el("div", { class: "tile__glyph is-word", "aria-hidden": "true" }, [el("span", { text: x.title })]);
  }
  function renderPerfumes() {
    var grid = document.getElementById("perfumeGrid");
    grid.innerHTML = "";
    var list = C.perfumes.filter(matches);
    document.getElementById("perfumesCount").textContent = list.length + " " + plural(list.length, "аромат", "аромата", "ароматов");
    list.forEach(function (p) {
      grid.appendChild(el("button", { class: "tile" + (p.inStock ? "" : " is-out"), type: "button", onclick: function () { openPerfume(p); } }, [
        el("div", { class: "tile__img" + (p.img ? "" : " is-empty") }, [
          p.img ? el("img", { src: p.img, alt: "Флакон «" + p.title + "»", loading: "lazy", decoding: "async" }) : noPhoto(p),
          el("span", { class: "tile__num", text: "№" + pad(p.n) }),
          p.inStock ? null : el("span", { class: "tile__badge", text: "нет в наличии" }),
        ]),
        fams(p).length ? el("p", { class: "tile__family", text: fams(p).join(" · ") }) : null,
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
    grid.innerHTML = "";
    var list = C.sprays.filter(matches);
    document.getElementById("sprays").hidden = !list.length;
    if (!list.length) return;
    var intro = document.getElementById("spraysIntro");
    if (C.info.sprays_intro) intro.textContent = C.info.sprays_intro; else intro.hidden = true;
    list.forEach(function (s) {
      var g = glyph(s);
      grid.appendChild(el("button", { class: "tile" + (s.inStock ? "" : " is-out"), type: "button", onclick: function () { openSpray(s); } }, [
        s.img ? el("div", { class: "tile__img" }, [el("img", { src: s.img, alt: "", loading: "lazy" })])
              : el("div", { class: "tile__glyph" + (g.word ? " is-word" : ""), "aria-hidden": "true" }, [el("span", { text: g.text })]),
        fams(s).length ? el("p", { class: "tile__family", text: fams(s).join(" · ") }) : null,
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

  function defaultImg(p) {
    var pr = p.prices[p.prices.length > 1 ? 1 : 0];
    return (pr && p.imgs && p.imgs[String(pr.ml)]) || p.img;
  }
  // Фото флакона под выбранный объём (если для него есть своё фото).
  function showVolume(item, ml) {
    var src = item.imgs && item.imgs[String(ml)];
    var img = document.querySelector(".pd__img img");
    if (src && img && img.getAttribute("src") !== src) img.setAttribute("src", src);
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
        showVolume(item, pr.ml);
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
      p.img ? el("div", { class: "pd__img" }, [el("img", { src: defaultImg(p), alt: "Флакон «" + p.title + "»" })]) : null,
      el("div", { class: "pd" }, [
        el("p", { class: "label", text: "Масляные духи · №" + pad(p.n) + (fams(p).length ? " · " + fams(p).join(", ") : "") }),
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
        el("div", { class: "line__sum", text: lineSum(it) != null ? rub(lineSum(it)) : "по запросу" }),
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
      var need = +C.promo.deliveryFrom || 0;
      note.push("Промокод " + C.promo.code + ": −" + C.promo.discount + "% на духи и спреи уже в сумме" + (hasSet ? ", набор — по цене промокода" : "") +
        (t.full > t.sum ? " (без скидки — " + rub(t.full) + ")" : "") + "." +
        (need ? (t.sum >= need ? " Доставка до ПВЗ — бесплатно." : " До бесплатной доставки до ПВЗ — ещё " + rub(need - t.sum) + ".") : ""));
    }
    if (t.open) note.push("У части позиций цена по запросу — менеджер подтвердит итог.");
    note.push("Оформление — в чате с ботом: имя, телефон и пункт выдачи. Ответим там же.");
    nodes.push(el("p", { class: "cart__note", text: note.join("\n") }));
    if (C.promo && !isPromo) nodes.push(codeForm());
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

  function codeForm() {
    var input = el("input", { class: "code__input", type: "text", autocomplete: "off", autocapitalize: "characters",
      spellcheck: "false", placeholder: "Промокод", "aria-label": "Промокод" });
    var msg = el("p", { class: "code__msg", role: "status" });
    function apply(e) {
      e.preventDefault();
      var v = input.value.replace(/\s+/g, "").toUpperCase();
      if (!v) { input.focus(); return; }
      if (v === String(C.promo.code).toUpperCase()) {
        isPromo = true; sessionFlag(true);
        renderPromo(); renderBar(); haptic("medium");
        toast("Промокод принят");
        openCart();
      } else {
        msg.textContent = "Такого промокода нет — проверьте написание.";
        input.select();
      }
    }
    return el("form", { class: "code", onsubmit: apply }, [
      el("label", { class: "label", text: "Есть промокод?" }),
      el("div", { class: "code__row" }, [input, el("button", { class: "btn btn--ghost code__btn", type: "submit", text: "Применить" })]),
      msg,
    ]);
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

  // Логотип в шапке — только когда крупный логотип первого экрана ушёл из виду.
  (function () {
    var top = document.querySelector(".top"), hero = document.querySelector(".hero__logo");
    if (!top || !hero || !("IntersectionObserver" in window)) return;
    top.classList.add("is-hero");
    new IntersectionObserver(function (es) { top.classList.toggle("is-hero", es[0].isIntersecting); }, { rootMargin: "-60px 0px 0px 0px" }).observe(hero);
  })();

  renderPromo(); renderFilters(); renderPerfumes(); renderSprays(); renderInfo(); renderBar();

  if (tg) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor && tg.setHeaderColor("#ece7df");
      tg.setBackgroundColor && tg.setBackgroundColor("#ece7df");
    } catch (e) { /* старый клиент */ }
  }
})();
