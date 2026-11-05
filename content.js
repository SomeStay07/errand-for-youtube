(() => {
  const L = globalThis.ErrandLib;
  const t = L.translator(chrome.i18n);
  const root = document.documentElement;
  root.dataset.erPage = L.pageType(location.pathname);
  let settings = L.mergeSettings();
  let intent = null;
  let pausedUntil = null;
  let resumeTimer = 0;
  let waitingVisible = false;
  let lastHref = null;
  let navToken = 0;
  let healthTimer = 0;
  let currentVideo = null;
  let pollTimer = 0;
  let heartbeatTimer = 0;
  let shownState = null;
  const mountGen = { related: 0, comments: 0 };
  const AUTOPLAY_BUTTON = 'button[data-tooltip-target-id="ytp-autonav-toggle-button"]';
  const SHORTS_LINK_ALLOWED = "#description, ytd-text-inline-expander, ytd-comments, ytd-multi-page-menu-renderer, tp-yt-iron-dropdown";
  const COMMENTS_PANEL = L.SELECTORS.commentsPanel;
  const COMMENTS = L.SELECTORS.comments;
  const SHORTS_GUIDE = 'ytd-guide-entry-renderer a[href^="/shorts"], ytd-mini-guide-entry-renderer a[href^="/shorts"]';
  const FOOTER_KEYS = { default: "intentFooter", edge: "intentFooter", opera: "intentFooterOpera", yandex: "intentFooterYandex", any: "intentFooterAny" };

  function alive() {
    return Boolean(globalThis.chrome?.runtime?.id);
  }

  function send(message) {
    if (!alive()) return false;
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  let isShutDown = false;

  function shutdown() {
    if (isShutDown) return;
    isShutDown = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(healthTimer);
    clearTimeout(resumeTimer);
    navToken += 1;
    document.removeEventListener("yt-navigate-finish", onNavigate);
    document.removeEventListener("ended", onEnded, true);
    watchObserver?.disconnect();
    for (const id of ["er-intent", "er-pill", "er-reveal", "er-comments", "er-end"]) document.getElementById(id)?.remove();
    document.addEventListener("yt-navigate-finish", () => {
      root.dataset.erPage = L.pageType(location.pathname);
    });
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  function waitFor(selector, callback, tries = 40) {
    const token = navToken;
    const attempt = (left) => {
      if (token !== navToken) return;
      const found = typeof selector === "function" ? selector() : document.querySelector(selector);
      if (found) callback(found);
      else if (left > 0) setTimeout(() => attempt(left - 1), 250);
    };
    attempt(tries);
  }

  function effective() {
    const strict = L.isStrict(settings, new Date());
    const paused = !strict && L.isPaused(pausedUntil, Date.now());
    return { hide: L.hiddenParts(settings, strict, paused), strict, paused };
  }

  function apply() {
    const { hide, strict, paused } = effective();
    for (const key of L.DEFAULT_HIDDEN) root.toggleAttribute(`data-er-show-${key}`, !hide[key]);
    for (const key of L.OPT_IN) root.toggleAttribute(`data-er-hide-${key}`, Boolean(hide[key]));
    root.toggleAttribute("data-er-strict", strict);
    root.toggleAttribute("data-er-no-autoplay", Boolean(settings.stopAutoplay) && !paused);
    if (paused) root.removeAttribute("data-er-autoplay-off");
    root.toggleAttribute("data-er-playlist", inList());
    root.dataset.erPage = L.pageType(location.pathname);
    renderPill(paused);
    return { hide, strict, paused };
  }

  function reconcileButtons(state, force = false) {
    const before = shownState;
    const page = root.dataset.erPage;
    const now = { related: L.wantsButton("related", page, state), comments: L.wantsButton("comments", page, state), paused: state.paused };
    shownState = now;
    if (!before && !force) return;
    if (force || now.related !== before.related) mountReveal(now.related);
    if (force || now.comments !== before.comments) mountCommentsButton(now.comments);
    if (!force && before.paused && !now.paused && root.dataset.erPage === "watch") stopAutoplay();
  }

  function update() {
    reconcileButtons(apply());
  }

  function redirect() {
    if (effective().paused) return false;
    const onShorts = L.pageType(location.pathname) === "shorts" && effective().hide.shorts;
    const target =
      (onShorts && (settings.shortsMode === "block" ? "/" : L.shortsToWatch(location.pathname, location.search))) ||
      (L.pageType(location.pathname) === "home" && L.homeRedirect(settings));
    if (!target) return false;
    location.replace(target);
    return true;
  }

  function onClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="/shorts/"]') : null;
    if (!link || !effective().hide.shorts) return;
    const url = new URL(link.href);
    const target = settings.shortsMode === "block" ? null : L.shortsToWatch(url.pathname, url.search);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target) location.assign(target);
  }

  function onKeydown(event) {
    if (!event.shiftKey || event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!settings.stopAutoplay || root.dataset.erPage !== "watch" || inList()) return;
    if (effective().paused) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, [contenteditable]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function startIntent(raw) {
    const text = raw.trim();
    if (!text) return;
    const go = () => location.assign(L.searchUrl(text));
    try {
      chrome.storage.local.set({ intent: { text, ts: Date.now() } }).then(go, go);
    } catch {
      go();
    }
  }

  function mountIntentPanel() {
    if (document.getElementById("er-intent")) return;
    const input = el("input", {
      type: "search",
      placeholder: t("intentPlaceholder"),
      "aria-label": t("intentAria"),
      autocomplete: "off",
    });
    const form = el(
      "form",
      {
        onsubmit: (event) => {
          event.preventDefault();
          startIntent(input.value);
        },
      },
      el("h1", {}, t("intentTitle")),
      input,
      el(
        "nav",
        {},
        el("a", { href: "/feed/subscriptions" }, t("linkSubscriptions")),
        el("a", { href: "/playlist?list=WL" }, t("linkWatchLater")),
        el("a", { href: "/feed/history" }, t("linkHistory")),
      ),
      el("p", { class: "er-footnote" }, footnote()),
    );
    document.body.append(el("div", { id: "er-intent" }, form));
  }

  function footnote() {
    try {
      const text = t(FOOTER_KEYS[L.browserHint(navigator, getComputedStyle(root))]);
      if (text) return text;
    } catch {}
    return t("intentFooter");
  }

  function renderPill(paused = effective().paused) {
    if (!document.body) return;
    const text = L.activeIntent(intent, Date.now());
    if (intent && !text) {
      intent = null;
      try {
        chrome.storage.local.remove("intent");
      } catch {}
    }
    let pill = document.getElementById("er-pill");
    if (!text || root.dataset.erPage === "home" || paused) {
      pill?.remove();
      return;
    }
    if (!pill) {
      pill = el(
        "div",
        { id: "er-pill" },
        el("a", { onclick: onPillLink }, searchIcon(), el("span")),
        el(
          "button",
          { type: "button", "aria-label": t("pillClear"), title: t("pillClear"), onclick: () => clearIntent(pill) },
          "×",
        ),
      );
      document.body.append(pill);
    }
    const link = pill.firstChild;
    const back = t("pillBack", text);
    link.lastChild.textContent = t("pillLabel", text);
    link.setAttribute("href", L.searchUrl(text));
    if (back) link.setAttribute("title", back);
    else link.removeAttribute("title");
  }

  function searchIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z");
    svg.append(path);
    return svg;
  }

  function onPillLink(event) {
    const target = new URL(event.currentTarget.href);
    const same = target.pathname === location.pathname && target.searchParams.get("search_query") === new URLSearchParams(location.search).get("search_query");
    if (same && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      scrollTo({ top: 0 });
    }
  }

  function clearIntent(pill) {
    if (pill.contains(document.activeElement)) document.querySelector('input[name="search_query"]')?.focus();
    try {
      chrome.storage.local.remove("intent");
    } catch {
      intent = null;
      pill.remove();
    }
  }

  function mountReveal(want) {
    const gen = ++mountGen.related;
    document.getElementById("er-reveal")?.remove();
    root.removeAttribute("data-er-reveal");
    if (!want) return;
    waitFor(relatedAnchor, (related) => {
      if (gen === mountGen.related && L.wantsButton("related", root.dataset.erPage, effective())) placeReveal(related);
    });
  }

  function relatedAnchor() {
    return document.querySelector("ytd-watch-grid #bottom-grid") || document.querySelector(`${L.SELECTORS.watchScope} #related`);
  }

  function placeReveal(related) {
    let button = document.getElementById("er-reveal");
    if (!button) {
      button = el("button", { id: "er-reveal", type: "button", "aria-live": "polite" }, t("revealButton"));
      button.addEventListener("click", () => countdown(button), { once: true });
    }
    if (button.nextElementSibling !== related) related.before(button);
  }

  function keepRevealInPlace() {
    const button = document.getElementById("er-reveal");
    if (!button || button.getAttribute("aria-disabled") === "true") return;
    const related = relatedAnchor();
    if (related) placeReveal(related);
  }

  function keepCommentsInPlace() {
    const button = document.getElementById("er-comments");
    const comments = document.querySelector(COMMENTS);
    if (button && comments && button.nextElementSibling !== comments) comments.before(button);
  }

  function mountCommentsButton(want) {
    const gen = ++mountGen.comments;
    document.getElementById("er-comments")?.remove();
    root.removeAttribute("data-er-reveal-comments");
    for (const node of document.querySelectorAll(`${COMMENTS}, ${COMMENTS_PANEL}`)) node.removeAttribute("tabindex");
    if (!want) return;
    waitFor(COMMENTS, (comments) => {
      if (gen !== mountGen.comments || !L.wantsButton("comments", root.dataset.erPage, effective())) return;
      document.getElementById("er-comments")?.remove();
      const button = el(
        "button",
        {
          id: "er-comments",
          type: "button",
          onclick: () => {
            root.setAttribute("data-er-reveal-comments", "");
            button.remove();
            const target = (comments.hidden && document.querySelector(COMMENTS_PANEL)) || comments;
            target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
          },
        },
        t("commentsButton"),
      );
      comments.before(button);
    });
  }

  function countdown(button) {
    let left = settings.revealSeconds;
    const total = left;
    button.setAttribute("aria-disabled", "true");
    const tick = () => {
      if (!button.isConnected) return;
      if (left <= 0) {
        const hadFocus = button === document.activeElement;
        root.setAttribute("data-er-reveal", "");
        button.remove();
        const related = relatedAnchor();
        if (hadFocus && related) {
          related.setAttribute("tabindex", "-1");
          related.focus({ preventScroll: true });
        }
        return;
      }
      if (left < total) button.removeAttribute("aria-live");
      button.textContent = t("revealCountdown", left);
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function inList() {
    const watch = document.querySelector("ytd-watch-flexy, ytd-watch-grid");
    return L.inList(location.search, watch ? watch.hasAttribute("playlist") : null);
  }

  const AUTOPLAY_FLAG = "errand-autoplay-off";

  function autoplayTurnedOff(value) {
    try {
      if (value === true) sessionStorage.setItem(AUTOPLAY_FLAG, "1");
      else if (value === false) sessionStorage.removeItem(AUTOPLAY_FLAG);
      return sessionStorage.getItem(AUTOPLAY_FLAG) === "1";
    } catch {
      return false;
    }
  }

  let watchObserver = null;

  function watchListPanel() {
    waitFor("ytd-watch-flexy, ytd-watch-grid", (watch) => {
      if (watchObserver) return;
      const sync = () => {
        if (!alive()) return shutdown();
        root.toggleAttribute("data-er-playlist", inList());
        if (root.dataset.erPage === "watch") stopAutoplay();
      };
      watchObserver = new MutationObserver(sync);
      watchObserver.observe(watch, { attributes: true, attributeFilter: ["playlist"] });
      sync();
    });
  }

  function stopAutoplay() {
    if (!settings.stopAutoplay || root.dataset.erPage !== "watch" || effective().paused) return;
    const token = navToken;
    const hasList = new URLSearchParams(location.search).has("list");
    waitFor(hasList ? AUTOPLAY_BUTTON : `${AUTOPLAY_BUTTON}:not([style*="none"])`, (button) => {
      setTimeout(() => {
        if (token !== navToken) return;
        const toggle = button.querySelector(".ytp-autonav-toggle-button");
        const checked = toggle?.getAttribute("aria-checked");
        if (inList()) {
          if (autoplayTurnedOff() && checked === "false") button.click();
          autoplayTurnedOff(false);
          root.removeAttribute("data-er-autoplay-off");
          return;
        }
        if (checked === "true") {
          button.click();
          autoplayTurnedOff(true);
        }
        setTimeout(() => {
          root.toggleAttribute("data-er-autoplay-off", toggle?.getAttribute("aria-checked") === "false");
        }, 300);
      }, hasList ? 1500 : 0);
    });
  }

  function autoplayChecked() {
    return document.querySelector(`${AUTOPLAY_BUTTON} .ytp-autonav-toggle-button`)?.getAttribute("aria-checked");
  }

  function syncAutoplayOff() {
    if (autoplayChecked() === "true") root.removeAttribute("data-er-autoplay-off");
  }

  function cancelUpNext() {
    if (!settings.stopAutoplay || autoplayChecked() === "false" || effective().paused || inList()) return;
    document.querySelector(".ytp-autonav-endscreen-upnext-cancel-button")?.click();
  }

  function showEndPrompt(player) {
    document.getElementById("er-end")?.remove();
    const text = L.activeIntent(intent, Date.now());
    const dismiss = () => {
      const prompt = document.getElementById("er-end");
      const hadFocus = Boolean(prompt?.contains(document.activeElement));
      prompt?.remove();
      if (hadFocus) player.focus({ preventScroll: true });
    };
    const actions = [
      el(
        "button",
        { type: "button", class: "er-primary", onclick: () => send({ type: "close-tab", errand: activeErrandId() }) || dismiss() },
        t("endClose"),
      ),
    ];
    if (text) {
      actions.push(el("button", { type: "button", onclick: () => location.assign(L.searchUrl(text)) }, t("endBack")));
    }
    actions.push(el("button", { type: "button", onclick: dismiss }, t("endStay")));
    const question = text ? t("endQuestionWithIntent", text) : t("endQuestion");
    const onkeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const prompt = el("div", { id: "er-end", role: "dialog", tabindex: "-1", "aria-label": question, onkeydown }, el("p", {}, question), el("div", { class: "er-actions" }, ...actions));
    const focusable = L.canTakeFocus(document.activeElement, document.body, player);
    player.append(prompt);
    if (focusable) prompt.focus({ preventScroll: true });
  }

  function activeErrandId() {
    return L.activeIntent(intent, Date.now()) ? intent.ts : null;
  }

  function onEnded(event) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    if (!video.classList.contains("html5-main-video") || root.dataset.erPage !== "watch") return;
    const player = document.getElementById("movie_player");
    if (!player || player.classList.contains("ad-showing")) return;
    if (!alive()) return shutdown();
    if (effective().paused) return;
    syncAutoplayOff();
    const errand = activeErrandId();
    if (errand !== null) send({ type: "errand", kind: "done", id: errand });
    if (!settings.endPrompt || inList()) return;
    setTimeout(cancelUpNext, 300);
    showEndPrompt(player);
  }

  function reportHealth(page, missing) {
    if (missing) root.setAttribute("data-er-health", missing.join(",") || "ok");
    else root.removeAttribute("data-er-health");
    send({ type: "health", page, missing: missing || [] });
  }

  function scheduleHealth() {
    clearTimeout(healthTimer);
    let pending = null;
    let runs = 0;
    const page = root.dataset.erPage;
    const checks = L.HEALTH[page];
    if (!checks) {
      reportHealth(page, effective().paused ? null : []);
      return;
    }
    if (effective().paused) {
      reportHealth(page, null);
      return;
    }
    healthTimer = setTimeout(function check() {
      if (document.hidden) {
        if (!waitingVisible) {
          waitingVisible = true;
          document.addEventListener(
            "visibilitychange",
            () => {
              waitingVisible = false;
              scheduleHealth();
            },
            { once: true },
          );
        }
        return;
      }
      const { hide, paused } = effective();
      if (paused) {
        reportHealth(page, null);
        return;
      }
      const live = Boolean(document.querySelector("ytd-live-chat-frame"));
      const playable = Number.isFinite(document.querySelector("video.html5-main-video")?.duration);
      const active = { ...hide, autoplay: Boolean(settings.stopAutoplay) };
      const missing = L.healthChecks(page, active, { live, playable })
        .filter(([, selector]) => !document.querySelector(selector))
        .map(([name]) => name);
      if (hide.shorts && visibleShorts() > 0) missing.push("shorts");
      for (const [name, selector] of L.LEAKS[page] || []) {
        if (hide[name] && !missing.includes(name) && isVisible(selector)) missing.push(name);
      }
      runs += 1;
      const verdict = L.confirmHealth(pending, missing);
      pending = verdict.pending;
      if (verdict.report) reportHealth(page, verdict.report);
      else if (runs < L.HEALTH_MAX_CHECKS) healthTimer = setTimeout(check, L.HEALTH_DELAY_MS);
      else reportHealth(page, pending);
    }, L.HEALTH_DELAY_MS);
  }

  function tagShorts() {
    if (!effective().hide.shorts) return;
    const guide = document.querySelector(SHORTS_GUIDE);
    const guideLabel = guide?.getAttribute("title") || guide?.textContent || "";
    for (const node of document.querySelectorAll("yt-tab-shape, yt-chip-cloud-chip-renderer")) {
      node.toggleAttribute("data-er-shorts", L.isShortsTitle(node.getAttribute("tab-title") || node.textContent, guideLabel));
    }
  }

  function isVisible(selector) {
    return [...document.querySelectorAll(selector)].some((node) => node.getBoundingClientRect().height > 0);
  }

  function visibleShorts() {
    return [...document.querySelectorAll('a[href^="/shorts/"]')].filter(
      (link) => link.getClientRects().length > 0 && !link.closest(SHORTS_LINK_ALLOWED),
    ).length;
  }

  function onNavigate() {
    if (!alive()) return shutdown();
    if (location.href === lastHref) return;
    lastHref = location.href;
    const video = L.pageType(location.pathname) === "watch" ? L.watchVideoId(location.pathname, location.search) : null;
    if (video && video === currentVideo) {
      update();
      return;
    }
    currentVideo = video;
    navToken += 1;
    if (redirect()) return;
    const state = apply();
    if (root.dataset.erPage === "watch") watchListPanel();
    document.getElementById("er-end")?.remove();
    reconcileButtons(state, true);
    root.removeAttribute("data-er-autoplay-off");
    stopAutoplay();
    setTimeout(tagShorts, 1500);
    scheduleHealth();
    if (root.dataset.erPage === "home") document.querySelector("#er-intent input")?.focus();
  }

  function whenBody(callback) {
    if (document.body) return callback();
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      callback();
    });
    observer.observe(root, { childList: true });
  }

  function onPlay(event) {
    if (event.target instanceof HTMLVideoElement && event.target.classList.contains("html5-main-video")) {
      document.getElementById("er-end")?.remove();
    }
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (!L.isPaused(pausedUntil, Date.now())) return;
    resumeTimer = setTimeout(resume, pausedUntil - Date.now() + 250);
  }

  function resume() {
    update();
    send({ type: "pause-ended" });
  }

  function load() {
    return chrome.storage.local.get(["settings", "intent", "pausedUntil"]).then((data) => {
      settings = L.mergeSettings(data.settings);
      intent = data.intent ?? null;
      pausedUntil = data.pausedUntil ?? null;
      scheduleResume();
    });
  }

  load().then(() => {
    apply();
    if (redirect()) return;
    document.addEventListener("yt-navigate-finish", onNavigate);
    document.addEventListener("ended", onEnded, true);
    document.addEventListener("play", onPlay, true);
    whenBody(() => {
      mountIntentPanel();
      onNavigate();
      watchListPanel();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      settings = L.mergeSettings(changes.settings.newValue);
      update();
      scheduleHealth();
    }
    if (changes.intent) {
      intent = changes.intent.newValue ?? null;
      renderPill();
    }
    if (changes.pausedUntil) {
      pausedUntil = changes.pausedUntil.newValue ?? null;
      update();
      scheduleResume();
      scheduleHealth();
    }
  });

  document.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKeydown, true);

  pollTimer = setInterval(() => {
    if (!alive()) return shutdown();
    if (document.hidden || lastHref === null) return;
    if (location.href !== lastHref) onNavigate();
    else {
      keepRevealInPlace();
      keepCommentsInPlace();
      syncAutoplayOff();
    }
    tagShorts();
  }, 1000);

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || !alive() || lastHref === null) return;
    load().then(() => {
      update();
      scheduleHealth();
    });
  });

  heartbeatTimer = setInterval(() => {
    if (!alive()) return shutdown();
    const wasStrict = root.hasAttribute("data-er-strict");
    update();
    if (root.hasAttribute("data-er-strict") !== wasStrict) send({ type: "sync" });
  }, 60_000);
})();
