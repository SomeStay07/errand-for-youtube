(function (root) {
  const DEFAULT_HIDDEN = ["home", "shorts", "related", "endscreen", "comments"];
  const OPT_IN = ["chat", "notifications", "metrics", "thumbs"];
  const HOME_TARGETS = { subs: "/feed/subscriptions", wl: "/playlist?list=WL" };
  const INTENT_TTL_MS = 3 * 60 * 60 * 1000;
  const PAUSE_MS = 15 * 60 * 1000;
  const PAUSE_WAIT_S = 10;

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

  const HEALTH = {
    watch: [
      ["player", "#movie_player"],
      ["related", "ytd-watch-flexy #related"],
      ["comments", "ytd-comments#comments"],
      ["autoplay", 'button[data-tooltip-target-id="ytp-autonav-toggle-button"]'],
      ["endscreen", ".html5-endscreen"],
    ],
    home: [["home", 'ytd-browse[page-subtype="home"]']],
    subs: [],
    channel: [],
    search: [["results", "ytd-search"]],
  };

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
    for (const key of ["strictStart", "strictEnd"]) if (/^\d{2}:\d{2}$/.test(s[key] ?? "")) out[key] = s[key];
    if (Number.isFinite(s.revealSeconds)) out.revealSeconds = Math.max(0, Math.min(120, Math.round(s.revealSeconds)));
    if (Array.isArray(s.strictDays)) {
      out.strictDays = [...new Set(s.strictDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
    }
    for (const [key, value] of Object.entries(s.hide || {})) if (key in out.hide && typeof value === "boolean") out.hide[key] = value;
    return out;
  }

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function isStrict(settings, date) {
    if (settings.mode === "strict") return true;
    if (settings.mode !== "auto") return false;
    if (!settings.strictDays.includes(date.getDay())) return false;
    const now = date.getHours() * 60 + date.getMinutes();
    const start = toMinutes(settings.strictStart);
    const end = toMinutes(settings.strictEnd);
    if (start === end) return false;
    return start < end ? now >= start && now < end : now >= start || now < end;
  }

  function pageType(pathname) {
    if (pathname === "/") return "home";
    if (pathname === "/watch") return "watch";
    if (pathname.startsWith("/shorts/")) return "shorts";
    if (pathname === "/results") return "search";
    if (pathname === "/feed/subscriptions") return "subs";
    if (pathname.startsWith("/playlist")) return "playlist";
    if (/^\/feed\/(history|library|you|playlists)/.test(pathname)) return "library";
    if (/^\/(@|channel\/|c\/|user\/)/.test(pathname)) return "channel";
    return "other";
  }

  function isRealPlaylist(search) {
    const params = new URLSearchParams(search);
    const list = params.get("list");
    return Boolean(list) && !list.startsWith("RD") && !params.has("start_radio");
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

  const FEEDBACK_FORM =
    "https://docs.google.com/forms/d/e/1FAIpQLScK_SZgLBU4-khfkJgem6Gfdk0JkcnCYq2bATd491NIQ6uAGQ/viewform?usp=pp_url&entry.870279470=VERSION&entry.1434595339=BROWSER&entry.2144774803=PAGE&entry.426719485=FILTERS";

  function reportUrl({ version, browser, page = "", missing = [] }, form = FEEDBACK_FORM) {
    const values = { VERSION: version, BROWSER: browser, PAGE: page, FILTERS: missing.join(", ") };
    if (form) {
      const url = new URL(form);
      for (const [key, value] of [...url.searchParams]) {
        if (value in values) url.searchParams.set(key, values[value]);
      }
      return url.toString();
    }
    const params = new URLSearchParams({
      template: "bug.yml",
      version,
      browser,
      page,
      filters: missing.join(", "),
    });
    return `${REPO_URL}/issues/new?${params}`;
  }

  const LOG_LIMIT = 30;

  function appendLog(log, { page, missing }, now) {
    const entry = { t: now, page, missing: [...missing] };
    return [...(Array.isArray(log) ? log : []), entry].slice(-LOG_LIMIT);
  }

  function formatDiagnostics(log, settings) {
    const head = `mode=${settings.mode} home=${settings.homeTarget} shorts=${settings.shortsMode}`;
    const recent = (Array.isArray(log) ? log : [])
      .slice(-12)
      .reverse()
      .map((e) => `${new Date(e.t).toISOString().slice(5, 16)} ${e.page}:${e.missing.join("+")}`);
    return [head, ...recent].join("; ").slice(0, 600);
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
    HEALTH,
    mergeSettings,
    isStrict,
    pageType,
    isRealPlaylist,
    shortsToWatch,
    homeRedirect,
    hiddenParts,
    activeIntent,
    searchUrl,
    LOG_LIMIT,
    appendLog,
    formatDiagnostics,
    reportUrl,
    REPO_URL,
    SITE_URL,
    BREAKAGE_URL,
    PRESETS,
    applyPreset,
    presetOf,
    welcomeLines,
    PAUSE_MS,
    PAUSE_WAIT_S,
    isPaused,
    isPauseStarting,
    canPause,
    dayKey,
    lastDays,
    addCount,
    errandEvent,
    errandTotals,
  };

  root.ErrandLib = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
