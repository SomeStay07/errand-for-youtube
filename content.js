(() => {
  const L = globalThis.ErrandLib;
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
  const root = document.documentElement;
  let settings = L.mergeSettings();
  let intent = null;
  let prevPath = referrerPath();
  let lastHref = null;
  let lastVideo = null;
  let navToken = 0;
  let healthTimer = 0;
  let currentVideo = null;
  const PLAYER_CHECKS = new Set(["autoplay", "endscreen"]);
  const AUTOPLAY_BUTTON = 'button[data-tooltip-target-id="ytp-autonav-toggle-button"]';
  const SHORTS_LINK_ALLOWED = "#description, ytd-text-inline-expander, ytd-comments, #er-intent";

  function referrerPath() {
    try {
      const ref = new URL(document.referrer);
      return ref.hostname.endsWith("youtube.com") ? ref.pathname : null;
    } catch {
      return null;
    }
  }

  function send(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {}
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
      const found = document.querySelector(selector);
      if (found) callback(found);
      else if (left > 0) setTimeout(() => attempt(left - 1), 250);
    };
    attempt(tries);
  }

  function effective() {
    const strict = L.isStrict(settings, new Date());
    return { hide: L.hiddenParts(settings, strict), strict };
  }

  function apply() {
    const { hide, strict } = effective();
    for (const key of L.DEFAULT_HIDDEN) root.toggleAttribute(`data-er-show-${key}`, !hide[key]);
    for (const key of L.OPT_IN) root.toggleAttribute(`data-er-hide-${key}`, Boolean(hide[key]));
    root.toggleAttribute("data-er-strict", strict);
    if (strict) {
      root.removeAttribute("data-er-reveal");
      root.removeAttribute("data-er-reveal-comments");
      document.getElementById("er-reveal")?.remove();
      document.getElementById("er-comments")?.remove();
    }
    root.toggleAttribute("data-er-no-autoplay", Boolean(settings.stopAutoplay));
    root.toggleAttribute("data-er-playlist", L.isRealPlaylist(location.search));
    root.dataset.erPage = L.pageType(location.pathname);
    renderPill();
  }

  function redirect() {
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
    if (!settings.stopAutoplay || root.dataset.erPage !== "watch" || L.isRealPlaylist(location.search)) return;
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
    );
    document.body.append(el("div", { id: "er-intent" }, form));
  }

  function renderPill() {
    if (!document.body) return;
    const text = L.activeIntent(intent, Date.now());
    if (intent && !text) {
      intent = null;
      try {
        chrome.storage.local.remove("intent");
      } catch {}
    }
    let pill = document.getElementById("er-pill");
    if (!text || root.dataset.erPage === "home") {
      pill?.remove();
      return;
    }
    if (!pill) {
      pill = el(
        "div",
        { id: "er-pill" },
        el("span"),
        el(
          "button",
          { type: "button", "aria-label": t("pillClear"), title: t("pillClear"), onclick: () => chrome.storage.local.remove("intent") },
          "×",
        ),
      );
      document.body.append(pill);
    }
    pill.firstChild.textContent = t("pillLabel", text);
  }

  function mountReveal() {
    document.getElementById("er-reveal")?.remove();
    root.removeAttribute("data-er-reveal");
    const { hide, strict } = effective();
    if (root.dataset.erPage !== "watch" || !hide.related || strict || settings.revealSeconds < 0) return;
    waitFor("ytd-watch-flexy #related", placeReveal);
  }

  function placeReveal(related) {
    let button = document.getElementById("er-reveal");
    if (!button) {
      button = el("button", { id: "er-reveal", type: "button" }, t("revealButton"));
      button.addEventListener("click", () => countdown(button), { once: true });
    }
    if (button.nextElementSibling !== related) related.before(button);
  }

  function keepRevealInPlace() {
    const button = document.getElementById("er-reveal");
    if (!button || button.disabled) return;
    const related = document.querySelector("ytd-watch-flexy #related");
    if (related) placeReveal(related);
  }

  function keepCommentsInPlace() {
    const button = document.getElementById("er-comments");
    const comments = document.querySelector("ytd-comments#comments");
    if (button && comments && button.nextElementSibling !== comments) comments.before(button);
  }

  function mountCommentsButton() {
    document.getElementById("er-comments")?.remove();
    root.removeAttribute("data-er-reveal-comments");
    const { hide, strict } = effective();
    if (root.dataset.erPage !== "watch" || !hide.comments || strict) return;
    waitFor("ytd-comments#comments", (comments) => {
      document.getElementById("er-comments")?.remove();
      const button = el(
        "button",
        {
          id: "er-comments",
          type: "button",
          onclick: () => {
            root.setAttribute("data-er-reveal-comments", "");
            button.remove();
          },
        },
        t("commentsButton"),
      );
      comments.before(button);
    });
  }

  function countdown(button) {
    let left = settings.revealSeconds;
    button.disabled = true;
    const tick = () => {
      if (!button.isConnected) return;
      if (left <= 0) {
        root.setAttribute("data-er-reveal", "");
        button.remove();
        return;
      }
      button.textContent = t("revealCountdown", left);
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function stopAutoplay() {
    if (!settings.stopAutoplay || root.dataset.erPage !== "watch") return;
    waitFor(`${AUTOPLAY_BUTTON}:not([style*="none"])`, (button) => {
      const toggle = button.querySelector(".ytp-autonav-toggle-button");
      if (toggle?.getAttribute("aria-checked") === "true") button.click();
      setTimeout(() => {
        root.toggleAttribute("data-er-autoplay-off", toggle?.getAttribute("aria-checked") === "false");
      }, 300);
    });
  }

  function cancelUpNext() {
    if (!settings.stopAutoplay || root.hasAttribute("data-er-autoplay-off")) return;
    document.querySelector(".ytp-autonav-endscreen-upnext-cancel-button")?.click();
  }

  function showEndPrompt(player) {
    document.getElementById("er-end")?.remove();
    const text = L.activeIntent(intent, Date.now());
    const dismiss = () => document.getElementById("er-end")?.remove();
    const actions = [
      el(
        "button",
        { type: "button", class: "er-primary", onclick: () => send({ type: "close-tab" }) },
        t("endClose"),
      ),
    ];
    if (text) {
      actions.push(el("button", { type: "button", onclick: () => location.assign(L.searchUrl(text)) }, t("endBack")));
    }
    actions.push(el("button", { type: "button", onclick: dismiss }, t("endStay")));
    const question = text ? t("endQuestionWithIntent", text) : t("endQuestion");
    player.append(el("div", { id: "er-end" }, el("p", {}, question), el("div", { class: "er-actions" }, ...actions)));
  }

  function onEnded(event) {
    const video = event.target;
    if (!settings.endPrompt || !(video instanceof HTMLVideoElement)) return;
    if (!video.classList.contains("html5-main-video") || root.dataset.erPage !== "watch") return;
    if (L.isRealPlaylist(location.search)) return;
    const player = document.getElementById("movie_player");
    if (!player || player.classList.contains("ad-showing")) return;
    setTimeout(cancelUpNext, 300);
    showEndPrompt(player);
  }

  function recordVisit() {
    const kind = L.classifyVisit(prevPath, location.pathname, location.search);
    if (!kind) return;
    const id = new URLSearchParams(location.search).get("v");
    if (!id || id === lastVideo) return;
    lastVideo = id;
    send({ type: "visit", kind });
  }

  function scheduleHealth() {
    clearTimeout(healthTimer);
    const page = root.dataset.erPage;
    const checks = L.HEALTH[page];
    if (!checks) {
      send({ type: "health", page, missing: [] });
      return;
    }
    healthTimer = setTimeout(() => {
      const live = Boolean(document.querySelector("ytd-live-chat-frame"));
      const playable = Number.isFinite(document.querySelector("video.html5-main-video")?.duration);
      const missing = checks
        .filter(([name]) => !(live && name === "comments") && !(!playable && PLAYER_CHECKS.has(name)))
        .filter(([, selector]) => !document.querySelector(selector))
        .map(([name]) => name);
      if (effective().hide.shorts && visibleShorts() > 0) missing.push("shorts");
      send({ type: "health", page, missing });
    }, 6000);
  }

  function tagShorts() {
    if (!effective().hide.shorts) return;
    for (const node of document.querySelectorAll("yt-tab-shape:not([data-er-shorts]), yt-chip-cloud-chip-renderer:not([data-er-shorts])")) {
      const title = (node.getAttribute("tab-title") || node.textContent || "").trim().toLowerCase();
      if (title === "shorts") node.setAttribute("data-er-shorts", "");
    }
  }

  function visibleShorts() {
    return [...document.querySelectorAll('a[href^="/shorts/"]')].filter(
      (link) => link.getClientRects().length > 0 && !link.closest(SHORTS_LINK_ALLOWED),
    ).length;
  }

  function onNavigate() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const video = L.pageType(location.pathname) === "watch" ? new URLSearchParams(location.search).get("v") : null;
    if (video && video === currentVideo) {
      apply();
      return;
    }
    currentVideo = video;
    navToken += 1;
    if (redirect()) return;
    apply();
    recordVisit();
    prevPath = location.pathname;
    document.getElementById("er-end")?.remove();
    mountReveal();
    mountCommentsButton();
    root.removeAttribute("data-er-autoplay-off");
    stopAutoplay();
    setTimeout(tagShorts, 1500);
    scheduleHealth();
    if (root.dataset.erPage === "home") document.querySelector("#er-intent input")?.focus();
  }

  function whenBody(callback) {
    if (document.body) callback();
    else document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  chrome.storage.local.get(["settings", "intent"]).then((data) => {
    settings = L.mergeSettings(data.settings);
    intent = data.intent ?? null;
    apply();
    if (redirect()) return;
    document.addEventListener("yt-navigate-finish", onNavigate);
    document.addEventListener("ended", onEnded, true);
    document.addEventListener("play", () => document.getElementById("er-end")?.remove(), true);
    whenBody(() => {
      mountIntentPanel();
      onNavigate();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      const before = revealState();
      settings = L.mergeSettings(changes.settings.newValue);
      apply();
      remountIfChanged(before);
    }
    if (changes.intent) {
      intent = changes.intent.newValue ?? null;
      renderPill();
    }
  });

  document.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKeydown, true);

  setInterval(() => {
    if (document.hidden || lastHref === null) return;
    if (location.href !== lastHref) onNavigate();
    else {
      keepRevealInPlace();
      keepCommentsInPlace();
    }
    tagShorts();
  }, 1000);

  function revealState() {
    const { hide, strict } = effective();
    return `${hide.related}|${hide.comments}|${strict}`;
  }

  function remountIfChanged(before) {
    if (revealState() === before) return;
    mountReveal();
    mountCommentsButton();
  }

  setInterval(() => {
    const before = revealState();
    apply();
    remountIfChanged(before);
  }, 60_000);
})();
