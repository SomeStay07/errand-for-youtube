(function (root) {
  const DEFAULT_HIDDEN = ["home", "shorts", "related", "endscreen", "comments"];
  const OPT_IN = ["chat", "notifications", "metrics", "thumbs"];
  const HOME_TARGETS = { subs: "/feed/subscriptions", wl: "/playlist?list=WL" };
  const INTENT_TTL_MS = 3 * 60 * 60 * 1000;
  const PAUSE_MS = 15 * 60 * 1000;
  const PAUSE_WAIT_S = 10;
  const STRICT_EXIT_LATE_MS = 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULTS = {
    mode: "relaxed",
    strictStart: "09:00",
    strictEnd: "18:00",
    strictDays: [1, 2, 3, 4, 5],
    hide: {
      related: true,
      endscreen: true,
      comments: true,
      chat: false,
      notifications: false,
      metrics: false,
      thumbs: false,
    },
    homeTarget: "ask",
    shortsMode: "watch",
    stopAutoplay: true,
    endPrompt: true,
    revealSeconds: 10,
  };

  const WATCH_SCOPE = ":is(ytd-watch-flexy, ytd-watch-grid)";
  const SUBS_PAGE = 'ytd-browse[page-subtype="subscriptions"]';
  const SUBS_SHELF_ITEM = "ytd-rich-shelf-renderer:not([is-shorts])";

  const SELECTORS = {
    watchScope: WATCH_SCOPE,
    related: `${WATCH_SCOPE} :is(#related, #bottom-grid, ytd-watch-next-secondary-results-renderer)`,
    comments: "ytd-comments#comments",
    commentsPanel: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]',
    subsShelf: `${SUBS_PAGE} ytd-rich-section-renderer:has(> #content > ${SUBS_SHELF_ITEM})`,
    searchShelf: "ytd-search ytd-item-section-renderer > #contents > :is(ytd-shelf-renderer, ytd-horizontal-card-list-renderer)",
  };

  const HEALTH = {
    watch: [
      ["player", "#movie_player"],
      ["related", `${WATCH_SCOPE} #related`],
      ["comments", SELECTORS.comments],
      ["autoplay", 'button[data-tooltip-target-id="ytp-autonav-toggle-button"]'],
      ["endscreen", ".html5-endscreen, .ytp-modern-videowall-still, .ytp-fullscreen-grid"],
    ],
    home: [["home", 'ytd-browse[page-subtype="home"]']],
    subs: [],
    channel: [],
    search: [["results", "ytd-search"]],
  };

  const PLAYER_CHECKS = ["autoplay", "endscreen"];

  function healthChecks(page, active, { live = false, playable = true } = {}) {
    return (HEALTH[page] || []).filter(
      ([name]) => active[name] !== false && !(live && name === "comments") && !(!playable && PLAYER_CHECKS.includes(name)),
    );
  }

  function wantsButton(part, page, { hide, strict, paused } = {}) {
    return page === "watch" && Boolean(hide?.[part]) && !strict && !paused;
  }

  const SUBS_SHELF = SELECTORS.subsShelf;

  const SEARCH_SHELF = SELECTORS.searchShelf;

  const WATCH_LEAK =
    `html:not([data-er-reveal]) ${WATCH_SCOPE} :is(yt-lockup-view-model, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer):not(:is(#movie_player, ytd-playlist-panel-renderer, #description, ytd-structured-description-content-renderer, ytd-engagement-panel-section-list-renderer, ytd-comments, #player-ads, ytd-ad-slot-renderer) *)`;

  const LEAKS = {
    subs: [["home", `${SUBS_PAGE} ytd-rich-section-renderer:has(${SUBS_SHELF_ITEM})`]],
    search: [["related", "ytd-search ytd-shelf-renderer, ytd-search ytd-horizontal-card-list-renderer:not(ytd-expandable-metadata-renderer *)"]],
    watch: [["related", WATCH_LEAK]],
  };

  const HEALTH_DELAY_MS = 6000;
  const HEALTH_MAX_CHECKS = 3;

  function confirmHealth(pending, missing) {
    if (!missing.length) return { report: [], pending: null };
    const confirmed = (pending || []).filter((name) => missing.includes(name));
    return confirmed.length ? { report: confirmed, pending: null } : { report: null, pending: missing };
  }

  function isShortsTitle(title, guideLabel) {
    const norm = (s) => String(s || "").trim().toLowerCase();
    const t = norm(title);
    return t === "shorts" || (Boolean(norm(guideLabel)) && t === norm(guideLabel));
  }

  const CHOICES = {
    mode: ["relaxed", "auto", "strict"],
    homeTarget: ["ask", "subs", "wl", "feed"],
    shortsMode: ["watch", "block", "show"],
  };

  function mergeSettings(stored) {
    const s = stored && typeof stored === "object" ? stored : {};
    const out = { ...DEFAULTS, hide: { ...DEFAULTS.hide } };
    for (const [key, allowed] of Object.entries(CHOICES)) if (allowed.includes(s[key])) out[key] = s[key];
    for (const key of ["stopAutoplay", "endPrompt"]) if (typeof s[key] === "boolean") out[key] = s[key];
    for (const key of ["strictStart", "strictEnd"]) if (parseTime(s[key]) !== null) out[key] = s[key];
    if (Number.isFinite(s.strictSkipUntil)) out.strictSkipUntil = s.strictSkipUntil;
    if (Number.isFinite(s.revealSeconds)) out.revealSeconds = Math.max(0, Math.min(120, Math.round(s.revealSeconds)));
    if (Array.isArray(s.strictDays)) {
      out.strictDays = [...new Set(s.strictDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
    }
    for (const [key, value] of Object.entries(s.hide || {})) if (Object.hasOwn(out.hide, key) && typeof value === "boolean") out.hide[key] = value;
    return out;
  }

  function patchSettings(stored, patch) {
    const next = mergeSettings(stored);
    for (const [key, value] of Object.entries(patch || {})) {
      if (key === "hide") {
        for (const [name, on] of Object.entries(value || {})) if (Object.hasOwn(next.hide, name) && typeof on === "boolean") next.hide[name] = on;
        continue;
      }
      const tried = mergeSettings({ ...next, [key]: value });
      const clamped = key === "revealSeconds" && Number.isFinite(value);
      if (clamped || JSON.stringify(tried[key]) === JSON.stringify(value)) next[key] = tried[key];
    }
    return mergeSettings(next);
  }

  function parseTime(hhmm) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof hhmm === "string" ? hhmm : "");
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function toMinutes(hhmm) {
    return parseTime(hhmm) ?? 0;
  }

  function isStrict(settings, date) {
    if (settings.mode === "strict") return true;
    if (settings.mode !== "auto") return false;
    if (isSkipped(settings, date)) return false;
    const now = date.getHours() * 60 + date.getMinutes();
    const start = toMinutes(settings.strictStart);
    const end = toMinutes(settings.strictEnd);
    if (start === end) return false;
    const day = date.getDay();
    if (start < end) return now >= start && now < end && settings.strictDays.includes(day);
    if (now >= start) return settings.strictDays.includes(day);
    return now < end && settings.strictDays.includes((day + 6) % 7);
  }

  function isSkipped(settings, date) {
    const left = settings.strictSkipUntil - date.getTime();
    return Number.isFinite(left) && left > 0 && left <= DAY_MS + 60 * 60 * 1000;
  }

  function nextStrictEnd(settings, date) {
    const [h, m] = [Math.floor(toMinutes(settings.strictEnd) / 60), toMinutes(settings.strictEnd) % 60];
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
    if (end.getTime() <= date.getTime()) end.setDate(end.getDate() + 1);
    return end.getTime();
  }

  function pageType(pathname) {
    if (pathname === "/") return "home";
    if (pathname === "/watch" || /^\/live\/[\w-]+\/?$/.test(pathname)) return "watch";
    if (pathname.startsWith("/shorts/")) return "shorts";
    if (pathname === "/results") return "search";
    if (pathname === "/feed/subscriptions") return "subs";
    if (pathname.startsWith("/playlist")) return "playlist";
    if (/^\/feed\/(history|library|you|playlists)/.test(pathname)) return "library";
    if (/^\/(@|channel\/|c\/|user\/)/.test(pathname)) return "channel";
    return "other";
  }

  function watchVideoId(pathname, search = "") {
    if (pathname === "/watch") return new URLSearchParams(search).get("v") || null;
    return /^\/live\/([\w-]+)\/?$/.exec(pathname)?.[1] || null;
  }

  function isRealPlaylist(search) {
    const params = new URLSearchParams(search);
    const list = params.get("list");
    return Boolean(list) && !list.startsWith("RD") && !params.has("start_radio");
  }

  function inList(search, shown) {
    if (shown && new URLSearchParams(search).get("list")) return true;
    return isRealPlaylist(search);
  }

  function shortsToWatch(pathname, search = "") {
    const match = /^\/shorts\/([\w-]{6,})/.exec(pathname);
    if (!match) return null;
    const params = new URLSearchParams(search);
    params.delete("v");
    const rest = params.toString();
    return `/watch?v=${match[1]}${rest ? `&${rest}` : ""}`;
  }

  function hiddenParts(settings, strict, paused = false) {
    if (paused && !strict) {
      return Object.fromEntries([...DEFAULT_HIDDEN, ...OPT_IN].map((key) => [key, false]));
    }
    const hide = {
      ...settings.hide,
      home: settings.homeTarget !== "feed",
      shorts: settings.shortsMode !== "show",
    };
    if (strict) for (const key of DEFAULT_HIDDEN) hide[key] = true;
    return hide;
  }

  function homeRedirect(settings) {
    return HOME_TARGETS[settings.homeTarget] || null;
  }

  function activeIntent(intent, now) {
    if (!intent || !intent.text || typeof intent.ts !== "number") return null;
    return now - intent.ts < INTENT_TTL_MS ? intent.text : null;
  }

  const REPO_URL = "https://github.com/SomeStay07/errand-for-youtube";
  const SITE_URL = "https://somestay07.github.io/errand-for-youtube";
  const BREAKAGE_URL = `${SITE_URL}/breakage/`;
  const STORE_URL = "https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg";

  const PRESETS = {
    ask: {
      homeTarget: "ask",
      shortsMode: "watch",
      stopAutoplay: true,
      endPrompt: true,
      hide: { related: true, endscreen: true, comments: true },
    },
    shorts: {
      homeTarget: "feed",
      shortsMode: "watch",
      stopAutoplay: false,
      endPrompt: false,
      hide: { related: false, endscreen: false, comments: false },
    },
    subs: {
      homeTarget: "subs",
      shortsMode: "watch",
      stopAutoplay: true,
      endPrompt: true,
      hide: { related: true, endscreen: true, comments: true },
    },
  };

  const WELCOME_LINES = {
    ask: ["welcomeAsk1", "welcomeHidden", "welcomeEnd"],
    shorts: ["welcomeShorts1", "welcomeShorts2", "welcomeShorts3"],
    subs: ["welcomeSubs1", "welcomeHidden", "welcomeEnd"],
  };

  function applyPreset(settings, id) {
    const base = mergeSettings(settings);
    const preset = PRESETS[id];
    if (!preset) return base;
    return mergeSettings({ ...base, ...preset, hide: { ...base.hide, ...preset.hide } });
  }

  function presetOf(settings) {
    const s = mergeSettings(settings);
    for (const [id, preset] of Object.entries(PRESETS)) {
      const top = Object.entries(preset).every(([key, value]) => key === "hide" || s[key] === value);
      const hide = Object.entries(preset.hide).every(([key, value]) => s.hide[key] === value);
      if (top && hide) return id;
    }
    return null;
  }

  function welcomeLines(id) {
    return WELCOME_LINES[id] || WELCOME_LINES.ask;
  }

  function isPaused(pausedUntil, now) {
    return Number.isFinite(pausedUntil) && pausedUntil > now && pausedUntil - now <= PAUSE_MS;
  }

  function isPauseStarting(startsAt, now) {
    return Number.isFinite(startsAt) && startsAt > now && startsAt - now <= PAUSE_WAIT_S * 1000 + 1000;
  }

  function canPause(settings, date, pausedUntil) {
    return !isStrict(settings, date) && !isPaused(pausedUntil, date.getTime());
  }

  function strictExit(settings, startsAt, date) {
    if (!isStrict(settings, date)) return "none";
    if (isPauseStarting(startsAt, date.getTime())) return "waiting";
    const late = date.getTime() - startsAt;
    return Number.isFinite(startsAt) && late >= 0 && late <= STRICT_EXIT_LATE_MS ? "due" : "none";
  }

  function endStrict(settings, date) {
    if (settings.mode === "auto") return mergeSettings({ ...settings, strictSkipUntil: nextStrictEnd(settings, date) });
    return mergeSettings({ ...settings, strictSkipUntil: undefined, mode: "relaxed" });
  }

  const FEEDBACK_FORM =
    "https://docs.google.com/forms/d/e/1FAIpQLScK_SZgLBU4-khfkJgem6Gfdk0JkcnCYq2bATd491NIQ6uAGQ/viewform?usp=pp_url&entry.870279470=VERSION&entry.1434595339=BROWSER&entry.2144774803=PAGE&entry.426719485=FILTERS";

  function reportUrl({ version, browser, page = "", missing = [] }, form = FEEDBACK_FORM) {
    const values = { VERSION: version, BROWSER: browser, PAGE: page, FILTERS: missing.join(", ") };
    const url = new URL(form || FEEDBACK_FORM);
    for (const [key, value] of [...url.searchParams]) {
      if (Object.hasOwn(values, value)) url.searchParams.set(key, values[value]);
    }
    return url.toString();
  }

  const LOG_LIMIT = 30;

  function appendLog(log, { page, missing }, now) {
    const entry = { t: now, page, missing: [...missing] };
    return [...(Array.isArray(log) ? log : []), entry].slice(-LOG_LIMIT);
  }

  function formatDiagnostics(log, settings) {
    const head = `mode=${settings?.mode} home=${settings?.homeTarget} shorts=${settings?.shortsMode}`;
    const valid = (e) => typeof e?.t === "number" && !Number.isNaN(new Date(e.t).getTime()) && Array.isArray(e.missing);
    const recent = (Array.isArray(log) ? log : [])
      .filter(valid)
      .slice(-12)
      .reverse()
      .map((e) => `${new Date(e.t).toISOString().slice(5, 16)} ${e.page}:${e.missing.join("+")}`);
    return [head, ...recent].join("; ").slice(0, 600);
  }

  function canTakeFocus(active, body, player) {
    if (!active || active === body) return true;
    if (active.closest("input, textarea, [contenteditable]")) return false;
    return Boolean(player?.contains(active));
  }

  function searchUrl(text) {
    return `/results?search_query=${encodeURIComponent(text)}`;
  }

  function dayKey(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function lastDays(count, date) {
    const keys = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - i);
      keys.push(dayKey(d));
    }
    return keys;
  }

  function addCount(stats, kind, date, keepDays = 30) {
    const key = dayKey(date);
    const source = stats && typeof stats === "object" ? stats : {};
    const day = { ...(source[key] || {}) };
    day[kind] = (day[kind] || 0) + 1;
    const keep = new Set(lastDays(keepDays, date));
    const next = {};
    for (const [k, v] of Object.entries(source)) if (keep.has(k)) next[k] = v;
    next[key] = day;
    return next;
  }

  function errandEvent(last, kind, id) {
    const prev = { done: null, closed: null, ...(last || {}) };
    if (typeof id !== "number" || !Number.isFinite(id)) return { count: false, last: prev };
    if (kind === "done") {
      return { count: id !== prev.done, last: { ...prev, done: id } };
    }
    if (kind === "closed") {
      const count = id === prev.done && id !== prev.closed;
      return { count, last: count ? { ...prev, closed: id } : prev };
    }
    return { count: false, last: prev };
  }

  const BROWSER_HINTS = ["default", "edge", "opera", "yandex", "any"];

  function browserHint(nav, rootStyle) {
    const read = (get) => {
      try {
        return get();
      } catch {
        return undefined;
      }
    };
    const arc = read(() => rootStyle.getPropertyValue("--arc-palette-title"));
    if (typeof arc === "string" && arc.trim()) return "any";
    const list = read(() => nav.userAgentData.brands);
    const brands = Array.isArray(list) ? list.map((b) => read(() => String(b.brand))).filter(Boolean) : [];
    const ua = read(() => nav.userAgent);
    const agent = typeof ua === "string" ? ua : "";
    const has = (re) => brands.some((b) => re.test(b));
    if (has(/yandex|yabrowser/i) || /YaBrowser\//.test(agent)) return "yandex";
    if (has(/^opera/i) || /\bOPR\/|\bOpera\b/.test(agent)) return "opera";
    if (/\bVivaldi\//.test(agent)) return "any";
    if (has(/^Microsoft Edge$/)) return "edge";
    if (has(/^Brave$/) || read(() => typeof nav.brave.isBrave) === "function") return "default";
    if (has(/^Google Chrome$/)) return "default";
    return "any";
  }

  function browserLabel(nav, lang) {
    let brand = "";
    try {
      const list = Array.isArray(nav?.userAgentData?.brands) ? nav.userAgentData.brands : [];
      const named = list.filter((b) => typeof b?.brand === "string" && !/Not.?A.?Brand|Chromium/i.test(b.brand));
      const ua = typeof nav?.userAgent === "string" ? nav.userAgent : "";
      brand = named[0] ? `${named[0].brand} ${named[0].version}` : (ua.match(/(Firefox|Edg|OPR|YaBrowser|Chrome)\/[\d]+/)?.[0] ?? "");
    } catch {}
    return `${brand} / ${lang}`;
  }

  function isFirefox(scope) {
    try {
      return typeof scope?.browser?.runtime?.getBrowserInfo === "function";
    } catch {
      return false;
    }
  }

  function translator(i18n) {
    return (key, ...subs) => i18n.getMessage(key, subs.map(String));
  }

  function localizeDocument(doc, t, lang) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = t("@@bidi_dir");
    for (const node of doc.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  }

  function clock(dateOrMs, lang) {
    return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(dateOrMs));
  }

  function clockOf(hhmm, lang) {
    const [h, m] = String(hhmm).split(":").map(Number);
    return clock(new Date(2026, 0, 1, h, m), lang);
  }

  const RATE_MIN_DONE = 5;
  const NOTE_MAX_SHOWS = 3;

  function shouldShowRate(stats, rateNote, date, flags) {
    if (flags?.warn || flags?.noteShown) return false;
    const note = rateNote && typeof rateNote === "object" ? rateNote : {};
    if (note.done === true || (Number(note.shown) || 0) >= NOTE_MAX_SHOWS) return false;
    if (errandTotals(stats, date).done < 1) return false;
    const source = stats && typeof stats === "object" ? stats : {};
    const total = Object.values(source).reduce((sum, day) => sum + (Number(day?.done) || 0), 0);
    return total >= RATE_MIN_DONE;
  }

  function minorOf(version) {
    const match = /^(\d+)(?:\.(\d+))?(?:\.\d+)*$/.exec(typeof version === "string" ? version : "");
    return match ? [Number(match[1]), Number(match[2] || 0)] : null;
  }

  function isNoteworthyUpdate(prev, next) {
    const a = minorOf(prev);
    const b = minorOf(next);
    if (!a || !b) return false;
    return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]);
  }

  function noteVersion(version) {
    const v = minorOf(version);
    return v ? `${v[0]}.${v[1]}` : null;
  }

  function updateNote(prev, next) {
    return isNoteworthyUpdate(prev, next) ? { version: noteVersion(next), shown: 0 } : null;
  }

  function shouldShowUpdateNote(note, flags) {
    if (flags?.warn || flags?.paused || !note || typeof note !== "object" || typeof note.version !== "string") return false;
    return (Number(note.shown) || 0) < NOTE_MAX_SHOWS;
  }

  function changesUrl(version) {
    return `${SITE_URL}/changes/#v${version}`;
  }

  function errandTotals(stats, date) {
    const totals = { done: 0, closed: 0 };
    for (const key of lastDays(7, date)) {
      const day = stats?.[key];
      totals.done += Number(day?.done) || 0;
      totals.closed += Number(day?.closed) || 0;
    }
    return totals;
  }

  const api = {
    DEFAULTS,
    DEFAULT_HIDDEN,
    OPT_IN,
    SELECTORS,
    HEALTH,
    healthChecks,
    PLAYER_CHECKS,
    wantsButton,
    SUBS_SHELF,
    SEARCH_SHELF,
    WATCH_LEAK,
    LEAKS,
    HEALTH_DELAY_MS,
    HEALTH_MAX_CHECKS,
    confirmHealth,
    isShortsTitle,
    BROWSER_HINTS,
    browserHint,
    browserLabel,
    isFirefox,
    translator,
    localizeDocument,
    clock,
    clockOf,
    RATE_MIN_DONE,
    NOTE_MAX_SHOWS,
    shouldShowRate,
    isNoteworthyUpdate,
    noteVersion,
    updateNote,
    shouldShowUpdateNote,
    changesUrl,
    mergeSettings,
    patchSettings,
    isStrict,
    isSkipped,
    nextStrictEnd,
    parseTime,
    pageType,
    watchVideoId,
    isRealPlaylist,
    inList,
    shortsToWatch,
    homeRedirect,
    hiddenParts,
    activeIntent,
    searchUrl,
    canTakeFocus,
    LOG_LIMIT,
    appendLog,
    formatDiagnostics,
    reportUrl,
    REPO_URL,
    SITE_URL,
    BREAKAGE_URL,
    STORE_URL,
    PRESETS,
    applyPreset,
    presetOf,
    welcomeLines,
    PAUSE_MS,
    PAUSE_WAIT_S,
    isPaused,
    isPauseStarting,
    canPause,
    strictExit,
    endStrict,
    dayKey,
    lastDays,
    addCount,
    errandEvent,
    errandTotals,
  };

  root.ErrandLib = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
