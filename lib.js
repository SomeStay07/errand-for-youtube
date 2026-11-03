(function (root) {
  const DEFAULT_HIDDEN = ["home", "shorts", "related", "endscreen", "comments"];
  const OPT_IN = ["chat", "notifications", "metrics", "thumbs"];
  const HOME_TARGETS = { subs: "/feed/subscriptions", wl: "/playlist?list=WL" };
  const INTENT_TTL_MS = 3 * 60 * 60 * 1000;
  const INTENDED_SOURCES = new Set(["search", "subs", "playlist", "channel", "library"]);

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

  function classifyVisit(prevPath, pathname, search) {
    if (pageType(pathname) !== "watch") return null;
    if (isRealPlaylist(search)) return "intended";
    if (prevPath === null) return "intended";
    return INTENDED_SOURCES.has(pageType(prevPath)) ? "intended" : "drift";
  }

  function shortsToWatch(pathname, search = "") {
    const match = /^\/shorts\/([\w-]{6,})/.exec(pathname);
    if (!match) return null;
    const params = new URLSearchParams(search);
    params.delete("v");
    const rest = params.toString();
    return `/watch?v=${match[1]}${rest ? `&${rest}` : ""}`;
  }

  function hiddenParts(settings, strict) {
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

  function addVisit(stats, kind, date, keepDays = 30) {
    const key = dayKey(date);
    const day = { intended: 0, drift: 0, ...(stats[key] || {}) };
    day[kind] += 1;
    const keep = new Set(lastDays(keepDays, date));
    const next = {};
    for (const [k, v] of Object.entries(stats)) if (keep.has(k)) next[k] = v;
    next[key] = day;
    return next;
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
    classifyVisit,
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
    dayKey,
    lastDays,
    addVisit,
  };

  root.ErrandLib = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
