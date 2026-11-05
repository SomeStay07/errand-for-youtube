const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

const at = (day, hh, mm = 0) => new Date(2026, 10, 1 + day, hh, mm);

test("auto mode is strict inside weekday window only", () => {
  const s = L.mergeSettings({ mode: "auto" });
  assert.equal(at(1, 10).getDay(), 1);
  assert.equal(L.isStrict(s, at(1, 10)), true);
  assert.equal(L.isStrict(s, at(1, 18)), false);
  assert.equal(L.isStrict(s, at(1, 8, 59)), false);
  assert.equal(L.isStrict(s, at(6, 10)), false);
});

test("overnight window wraps past midnight", () => {
  const s = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "07:00", strictDays: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(L.isStrict(s, at(2, 23)), true);
  assert.equal(L.isStrict(s, at(2, 3)), true);
  assert.equal(L.isStrict(s, at(2, 12)), false);
});

test("explicit modes override schedule", () => {
  assert.equal(L.isStrict(L.mergeSettings({ mode: "strict" }), at(6, 23)), true);
  assert.equal(L.isStrict(L.mergeSettings({ mode: "relaxed" }), at(1, 10)), false);
});

test("mergeSettings drops invalid imported values", () => {
  const s = L.mergeSettings({
    mode: "chaos",
    revealSeconds: "x",
    strictDays: [1, "2", 9, 3.5, 5],
    strictStart: "9am",
    homeTarget: "subs",
    hide: { comments: "yes", related: false, bogus: true },
  });
  assert.equal(s.mode, "relaxed");
  assert.equal(s.revealSeconds, 10);
  assert.deepEqual(s.strictDays, [1, 5]);
  assert.equal(s.strictStart, "09:00");
  assert.equal(s.homeTarget, "subs");
  assert.equal(s.hide.comments, true);
  assert.equal(s.hide.related, false);
  assert.equal("bogus" in s.hide, false);
});

test("new installs start in relaxed mode", () => {
  assert.equal(L.mergeSettings().mode, "relaxed");
});

test("home and Shorts visibility follow their selects, strict hides everything", () => {
  const relaxed = L.hiddenParts(L.mergeSettings({ homeTarget: "feed", shortsMode: "show", hide: { comments: false } }), false);
  assert.equal(relaxed.home, false);
  assert.equal(relaxed.shorts, false);
  assert.equal(relaxed.comments, false);
  const strict = L.hiddenParts(L.mergeSettings({ homeTarget: "feed", shortsMode: "show", hide: { comments: false } }), true);
  for (const key of L.DEFAULT_HIDDEN) assert.equal(strict[key], true, key);
  const defaults = L.hiddenParts(L.mergeSettings(), false);
  assert.equal(defaults.home, true);
  assert.equal(defaults.shorts, true);
});

test("mergeSettings keeps defaults for missing hide keys", () => {
  const s = L.mergeSettings({ hide: { comments: false } });
  assert.equal(s.hide.comments, false);
  assert.equal(s.hide.related, true);
  assert.equal(s.revealSeconds, 10);
});

test("shorts links map to the regular player", () => {
  assert.equal(L.shortsToWatch("/shorts/dQw4w9WgXcQ"), "/watch?v=dQw4w9WgXcQ");
  assert.equal(L.shortsToWatch("/shorts/"), null);
  assert.equal(L.shortsToWatch("/watch"), null);
  assert.equal(L.shortsToWatch("/shorts/dQw4w9WgXcQ", "?feature=share"), "/watch?v=dQw4w9WgXcQ&feature=share");
});

test("report link carries only version, browser, page type and broken filters", () => {
  const url = new URL(L.reportUrl({ version: "0.1.0", browser: "Chrome 142 / ru", page: "watch", missing: ["shorts", "related"] }, ""));
  assert.equal(url.origin + url.pathname, `${L.REPO_URL}/issues/new`);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["browser", "filters", "page", "template", "version"]);
  assert.equal(url.searchParams.get("filters"), "shorts, related");
});

test("report link fills a prefilled feedback form when one is configured", () => {
  const form = "https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.1=VERSION&entry.2=BROWSER&entry.3=PAGE&entry.4=FILTERS";
  const url = new URL(L.reportUrl({ version: "0.1.0", browser: "Firefox 140 / de", page: "search", missing: ["shorts"] }, form));
  assert.equal(url.searchParams.get("entry.1"), "0.1.0");
  assert.equal(url.searchParams.get("entry.2"), "Firefox 140 / de");
  assert.equal(url.searchParams.get("entry.3"), "search");
  assert.equal(url.searchParams.get("entry.4"), "shorts");
  assert.equal(url.searchParams.get("usp"), "pp_url");
});

test("diagnostics log keeps the newest entries and formats compactly", () => {
  let log = [];
  for (let i = 0; i < 40; i += 1) log = L.appendLog(log, { page: "watch", missing: ["related"] }, 1_700_000_000_000 + i * 60_000);
  assert.equal(log.length, L.LOG_LIMIT);
  const text = L.formatDiagnostics(log, L.mergeSettings({ mode: "auto", shortsMode: "block" }));
  assert.ok(text.startsWith("mode=auto home=ask shorts=block"));
  assert.ok(text.includes("watch:related"));
  assert.ok(text.length <= 600);
});

test("intent expires after three hours", () => {
  const ts = 1_000_000;
  assert.equal(L.activeIntent({ text: "swift", ts }, ts + 60_000), "swift");
  assert.equal(L.activeIntent({ text: "swift", ts }, ts + 3 * 60 * 60 * 1000), null);
  assert.equal(L.activeIntent(null, ts), null);
});

test("lastDays returns oldest first and crosses month boundary", () => {
  assert.deepEqual(L.lastDays(3, new Date(2026, 10, 2)), ["2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("only real playlists count as playlists", () => {
  assert.equal(L.isRealPlaylist("?v=a&list=PL123"), true);
  assert.equal(L.isRealPlaylist("?v=a&list=WL"), true);
  assert.equal(L.isRealPlaylist("?v=a&list=RDa"), false);
  assert.equal(L.isRealPlaylist("?v=a&list=PL1&start_radio=1"), false);
  assert.equal(L.isRealPlaylist("?v=a"), false);
});

test("home redirect follows the chosen target", () => {
  assert.equal(L.homeRedirect(L.mergeSettings()), null);
  assert.equal(L.homeRedirect(L.mergeSettings({ homeTarget: "subs" })), "/feed/subscriptions");
  assert.equal(L.homeRedirect(L.mergeSettings({ homeTarget: "wl" })), "/playlist?list=WL");
});

test("ask preset equals the defaults, so untouched installs behave like 0.1", () => {
  const d = L.mergeSettings();
  for (const [key, value] of Object.entries(L.PRESETS.ask)) {
    if (key === "hide") for (const [h, v] of Object.entries(value)) assert.equal(d.hide[h], v, h);
    else assert.equal(d[key], value, key);
  }
  assert.equal(L.presetOf(d), "ask");
});

test("shorts preset shows the feed and video page, keeps strict and opt-in settings", () => {
  const before = L.mergeSettings({ mode: "auto", strictStart: "08:00", strictDays: [1, 2], hide: { metrics: true } });
  const s = L.applyPreset(before, "shorts");
  assert.equal(s.homeTarget, "feed");
  assert.equal(s.shortsMode, "watch");
  assert.equal(s.stopAutoplay, false);
  assert.equal(s.endPrompt, false);
  assert.deepEqual([s.hide.related, s.hide.endscreen, s.hide.comments], [false, false, false]);
  assert.equal(s.mode, "auto");
  assert.equal(s.strictStart, "08:00");
  assert.deepEqual(s.strictDays, [1, 2]);
  assert.equal(s.hide.metrics, true);
  assert.equal(L.presetOf(s), "shorts");
});

test("unknown preset leaves settings unchanged and customized settings match no preset", () => {
  const s = L.mergeSettings({ homeTarget: "wl" });
  assert.deepEqual(L.applyPreset(s, "nope"), L.mergeSettings(s));
  const subs = L.applyPreset(L.mergeSettings(), "subs");
  assert.equal(L.presetOf(subs), "subs");
  assert.equal(L.presetOf({ ...subs, hide: { ...subs.hide, comments: false } }), null);
});

test("welcome lines give three keys per preset and fall back to ask", () => {
  for (const id of ["ask", "shorts", "subs"]) assert.equal(L.welcomeLines(id).length, 3);
  assert.deepEqual(L.welcomeLines("nope"), L.welcomeLines("ask"));
});

test("errand events count each errand once and closed only after done", () => {
  let r = L.errandEvent(undefined, "done", 1);
  assert.equal(r.count, true);
  r = L.errandEvent(r.last, "done", 1);
  assert.equal(r.count, false);
  r = L.errandEvent(r.last, "closed", 1);
  assert.equal(r.count, true);
  r = L.errandEvent(r.last, "closed", 1);
  assert.equal(r.count, false);
  r = L.errandEvent(r.last, "closed", 2);
  assert.equal(r.count, false);
  r = L.errandEvent(r.last, "done", 2);
  assert.equal(r.count, true);
  r = L.errandEvent(r.last, "closed", 2);
  assert.equal(r.count, true);
  assert.equal(L.errandEvent(r.last, "done", "3").count, false);
});

test("addCount keeps other fields and drops days older than 30", () => {
  const today = new Date(2026, 10, 3);
  let stats = { "2026-09-01": { done: 5 }, "2026-11-03": { intended: 4 } };
  stats = L.addCount(stats, "done", today);
  stats = L.addCount(stats, "done", today);
  stats = L.addCount(stats, "closed", today);
  assert.deepEqual(stats, { "2026-11-03": { intended: 4, done: 2, closed: 1 } });
});

test("errandTotals sums the last 7 days and ignores old visit fields", () => {
  const today = new Date(2026, 10, 3);
  const stats = {
    "2026-11-03": { done: 2, closed: 1, intended: 9, drift: 9 },
    "2026-10-30": { done: 1 },
    "2026-10-20": { done: 7, closed: 7 },
  };
  assert.deepEqual(L.errandTotals(stats, today), { done: 3, closed: 1 });
  assert.deepEqual(L.errandTotals({}, today), { done: 0, closed: 0 });
});

test("pause lasts at most 15 minutes and is ignored when strict", () => {
  const now = 1_000_000;
  assert.equal(L.isPaused(now + 60_000, now), true);
  assert.equal(L.isPaused(now, now), false);
  assert.equal(L.isPaused(now - 1, now), false);
  assert.equal(L.isPaused(now + L.PAUSE_MS + 1, now), false);
  assert.equal(L.isPaused(undefined, now), false);
  assert.equal(L.isPaused("9999999999999", now), false);
  const relaxed = L.mergeSettings();
  const strict = L.mergeSettings({ mode: "strict" });
  const date = new Date(now);
  assert.equal(L.canPause(relaxed, date, undefined), true);
  assert.equal(L.canPause(strict, date, undefined), false);
  assert.equal(L.canPause(relaxed, date, now + 1000), false);
  const off = L.hiddenParts(relaxed, false, true);
  assert.ok(Object.values(off).every((v) => v === false));
  assert.deepEqual(L.hiddenParts(relaxed, true, true), L.hiddenParts(relaxed, true, false));
});

test("a pending pause start is valid only within the wait window", () => {
  const now = 5_000_000;
  assert.equal(L.isPauseStarting(now + 9_000, now), true);
  assert.equal(L.isPauseStarting(now - 1, now), false);
  assert.equal(L.isPauseStarting(now + 60_000, now), false);
  assert.equal(L.isPauseStarting(undefined, now), false);
});

test("breakage page lives on the site", () => {
  assert.ok(L.BREAKAGE_URL.startsWith(L.SITE_URL));
  assert.ok(L.BREAKAGE_URL.endsWith("/breakage/"));
});

test("strict exit waits like pause and only while strict", () => {
  const strict = L.mergeSettings({ mode: "strict" });
  const relaxed = L.mergeSettings({ mode: "relaxed" });
  const date = at(1, 10);
  const now = date.getTime();
  assert.equal(L.strictExit(strict, now + 9_000, date), "waiting");
  assert.equal(L.strictExit(strict, now, date), "due");
  assert.equal(L.strictExit(strict, now - 30_000, date), "due");
  assert.equal(L.strictExit(strict, now - 61_000, date), "none");
  assert.equal(L.strictExit(strict, now - 24 * 60 * 60 * 1000, date), "none");
  assert.equal(L.strictExit(strict, now + 60_000, date), "none");
  assert.equal(L.strictExit(strict, undefined, date), "none");
  assert.equal(L.strictExit(relaxed, now + 9_000, date), "none");
  assert.equal(L.strictExit(relaxed, now, date), "none");
});

test("strict exit in the auto window is abandoned outside the window", () => {
  const auto = L.mergeSettings({ mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [1] });
  const inside = at(1, 10);
  const outside = at(1, 19);
  assert.equal(L.strictExit(auto, inside.getTime() + 5_000, inside), "waiting");
  assert.equal(L.strictExit(auto, outside.getTime(), outside), "none");
});

test("turning strict off in always mode sets mode to relaxed", () => {
  const off = L.endStrict(L.mergeSettings({ mode: "strict", strictStart: "08:00" }), at(1, 10));
  assert.equal(off.mode, "relaxed");
  assert.equal(off.strictStart, "08:00");
  assert.equal(off.strictSkipUntil, undefined);
});

test("turning strict off in the schedule skips only the current window", () => {
  const auto = L.mergeSettings({ mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [1, 2] });
  const off = L.endStrict(auto, at(1, 10));
  assert.equal(off.mode, "auto");
  assert.deepEqual(off.strictDays, [1, 2]);
  assert.equal(off.strictSkipUntil, at(1, 18).getTime());
  assert.equal(auto.strictSkipUntil, undefined);
  assert.equal(L.isStrict(off, at(1, 10)), false);
  assert.equal(L.isStrict(off, at(1, 17, 59)), false);
  assert.equal(L.isStrict(off, at(2, 9)), true);
  assert.equal(L.canPause(off, at(1, 10), undefined), true);
});

test("a skipped window that crosses midnight ends at the next strictEnd", () => {
  const night = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "06:00", strictDays: [0, 1, 2, 3, 4, 5, 6] });
  const late = L.endStrict(night, at(1, 23));
  assert.equal(late.strictSkipUntil, at(2, 6).getTime());
  assert.equal(L.isStrict(late, at(2, 5, 59)), false);
  assert.equal(L.isStrict(late, at(2, 22)), true);
  const early = L.endStrict(night, at(2, 2));
  assert.equal(early.strictSkipUntil, at(2, 6).getTime());
});

test("a strict skip expires and a stale or far one is ignored", () => {
  const auto = { mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [1, 2] };
  const expired = L.mergeSettings({ ...auto, strictSkipUntil: at(1, 18).getTime() });
  assert.equal(L.isStrict(expired, at(2, 10)), true);
  assert.equal(L.isSkipped(expired, at(2, 10)), false);
  const far = L.mergeSettings({ ...auto, strictSkipUntil: at(9, 18).getTime() });
  assert.equal(L.isStrict(far, at(1, 10)), true);
  const always = L.mergeSettings({ mode: "strict", strictSkipUntil: at(1, 18).getTime() });
  assert.equal(L.isStrict(always, at(1, 10)), true);
  assert.equal(L.mergeSettings({ ...auto, strictSkipUntil: "x" }).strictSkipUntil, undefined);
});

test("most relevant shelf on subscriptions follows the home filter", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "..", "hide.css"), "utf8");
  const homeGroup = css.slice(0, css.indexOf("}"));
  assert.ok(homeGroup.startsWith("html:not([data-er-show-home])"));
  assert.ok(homeGroup.includes(L.SUBS_SHELF));
  assert.match(L.SUBS_SHELF, /^ytd-browse\[page-subtype="subscriptions"\] /);
  assert.match(L.SUBS_SHELF, /ytd-rich-shelf-renderer:not\(\[is-shorts\]\)/);
  assert.doesNotMatch(L.SUBS_SHELF, /ytd-shelf-renderer|relevant/i);
  assert.deepEqual(L.LEAKS.subs.map(([name]) => name), ["home"]);
  const [, leak] = L.LEAKS.subs[0];
  assert.equal(leak, L.SUBS_SHELF.replace("> #content > ", ""));
  assert.deepEqual(L.HEALTH.subs, []);
});

test("endscreen presence matches the current player and only hidden parts are hidden", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "hide.css"), "utf8");
  const [, endscreen] = L.HEALTH.watch.find(([name]) => name === "endscreen");
  const parts = endscreen.split(",").map((part) => part.trim());
  assert.ok(parts.includes(".ytp-modern-videowall-still"));
  assert.ok(parts.includes(".ytp-fullscreen-grid"));
  for (const part of parts) assert.ok(css.includes(part), part);
});

test("presence checks run only for filters that are hiding", () => {
  const names = (page, active) => L.healthChecks(page, active).map(([name]) => name);
  const all = { related: true, endscreen: true, comments: true, autoplay: true };
  assert.deepEqual(names("watch", all), ["player", "related", "comments", "autoplay", "endscreen"]);
  assert.deepEqual(names("watch", { related: false, endscreen: false, comments: false, autoplay: false }), ["player"]);
  assert.deepEqual(names("watch", { ...all, endscreen: false }), ["player", "related", "comments", "autoplay"]);
  assert.deepEqual(names("home", { home: false }), []);
  assert.deepEqual(names("home", { home: true }), ["home"]);
  assert.deepEqual(names("search", {}), ["results"]);
  assert.deepEqual(names("other", all), []);
});

test("store link points to Errand's Chrome Web Store item", () => {
  assert.equal(L.STORE_URL, "https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg");
});

test("manifest asks for storage and nothing else", () => {
  const manifest = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
});

test("end prompt takes focus only from the page body or the player, never from a text field", () => {
  const node = (inside, editable) => ({ closest: (sel) => (editable && sel.includes("input") ? {} : null), inside });
  const body = { closest: () => null };
  const player = { contains: (n) => Boolean(n.inside) };
  assert.equal(L.canTakeFocus(null, body, player), true);
  assert.equal(L.canTakeFocus(body, body, player), true);
  assert.equal(L.canTakeFocus(node(true, false), body, player), true);
  assert.equal(L.canTakeFocus(node(false, false), body, player), false);
  assert.equal(L.canTakeFocus(node(false, true), body, player), false);
  assert.equal(L.canTakeFocus(node(true, true), body, player), false);
});

function inZone(zone, run) {
  const saved = process.env.TZ;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

test("a night window belongs to the day it starts on, not the day it ends on", () => {
  inZone("Europe/Madrid", () => {
    const s = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "06:00", strictDays: [1, 2, 3, 4, 5] });
    assert.equal(at(5, 23).getDay(), 5);
    assert.equal(L.isStrict(s, at(5, 23)), true);
    assert.equal(L.isStrict(s, at(6, 1)), true);
    assert.equal(L.isStrict(s, at(6, 5, 59)), true);
    assert.equal(L.isStrict(s, at(6, 6)), false);
    assert.equal(L.isStrict(s, at(6, 23)), false);
    assert.equal(L.isStrict(s, at(7, 1)), false);
    assert.equal(L.isStrict(s, at(8, 1)), false);
    assert.equal(L.isStrict(s, at(8, 23)), true);
    assert.equal(L.isStrict(s, at(9, 1)), true);
  });
});

test("a night window keeps its day across the autumn DST change in Madrid", () => {
  inZone("Europe/Madrid", () => {
    const sat = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "06:00", strictDays: [6] });
    const d = (date, hh, mm = 0) => new Date(2026, 9, date, hh, mm);
    assert.equal(d(24, 23).getDay(), 6);
    assert.equal(new Date(2026, 9, 25, 4).getTime() - new Date(2026, 9, 25, 1).getTime(), 4 * 60 * 60 * 1000);
    assert.equal(L.isStrict(sat, d(24, 23)), true);
    assert.equal(L.isStrict(sat, d(25, 1)), true);
    assert.equal(L.isStrict(sat, new Date(Date.UTC(2026, 9, 25, 0, 30))), true);
    assert.equal(L.isStrict(sat, new Date(Date.UTC(2026, 9, 25, 1, 30))), true);
    assert.equal(L.isStrict(sat, d(25, 5, 59)), true);
    assert.equal(L.isStrict(sat, d(25, 6)), false);
    assert.equal(L.isStrict(sat, d(25, 23)), false);
    assert.equal(L.isStrict(sat, d(26, 1)), false);
    const skip = L.endStrict(sat, d(25, 2, 30));
    assert.equal(skip.strictSkipUntil, d(25, 6).getTime());
    assert.equal(L.isStrict(skip, d(25, 5)), false);
  });
});

test("a night window keeps its day across the spring DST change in Madrid", () => {
  inZone("Europe/Madrid", () => {
    const sat = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "06:00", strictDays: [6] });
    const skipped = new Date(2026, 2, 29, 2, 30);
    assert.equal(skipped.getHours(), 3);
    assert.equal(L.isStrict(sat, new Date(2026, 2, 28, 23)), true);
    assert.equal(L.isStrict(sat, skipped), true);
    assert.equal(L.isStrict(sat, new Date(2026, 2, 29, 6)), false);
    assert.equal(L.isStrict(sat, new Date(2026, 2, 30, 1)), false);
  });
});

test("a night window from Sunday wraps into Monday and back to Sunday", () => {
  inZone("America/New_York", () => {
    const sun = L.mergeSettings({ mode: "auto", strictStart: "23:30", strictEnd: "00:30", strictDays: [0] });
    assert.equal(at(0, 23, 45).getDay(), 0);
    assert.equal(L.isStrict(sun, at(0, 23, 45)), true);
    assert.equal(L.isStrict(sun, at(1, 0, 15)), true);
    assert.equal(L.isStrict(sun, at(0, 0, 15)), false);
    assert.equal(L.isStrict(sun, at(1, 23, 45)), false);
  });
});

test("patchSettings writes one change over the stored settings", () => {
  const stored = { mode: "auto", strictSkipUntil: at(1, 18).getTime(), hide: { related: false, chat: true } };
  const next = L.patchSettings(stored, { hide: { comments: false } });
  assert.equal(next.mode, "auto");
  assert.equal(next.strictSkipUntil, at(1, 18).getTime());
  assert.deepEqual(next.hide, { ...L.DEFAULTS.hide, related: false, chat: true, comments: false });
  assert.equal(L.patchSettings({ mode: "relaxed" }, { stopAutoplay: false }).mode, "relaxed");
  assert.deepEqual(L.patchSettings(undefined, { strictDays: [0] }).strictDays, [0]);
});

test("patchSettings keeps the stored value when a patch value would be rejected", () => {
  const stored = { mode: "auto", strictStart: "22:00", strictEnd: "06:00", hide: { comments: false } };
  assert.equal(L.patchSettings(stored, { strictStart: "" }).strictStart, "22:00");
  assert.equal(L.patchSettings(stored, { strictStart: "23:15" }).strictStart, "23:15");
  assert.equal(L.patchSettings(stored, { mode: "chaos" }).mode, "auto");
  assert.equal(L.patchSettings(stored, { hide: { comments: "yes" } }).hide.comments, false);
  assert.deepEqual(L.patchSettings(stored, { strictDays: [9] }).strictDays, L.DEFAULTS.strictDays);
  assert.deepEqual(L.patchSettings(stored, { strictDays: [] }).strictDays, []);
});

const hideCss = () => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "hide.css"), "utf8");

function cssGroup(css, start) {
  const from = css.indexOf(start);
  assert.ok(from >= 0, start);
  return css.slice(from, css.indexOf("}", from));
}

test("Shorts inside the new lockup, Playables and Watch & Play follow the Shorts setting", () => {
  const css = hideCss();
  const shorts = cssGroup(css, "html:not([data-er-show-shorts])");
  for (const part of [
    'yt-lockup-view-model:has(a[href^="/shorts/"])',
    "ytd-rich-section-renderer:has(ytd-mini-game-card-view-model)",
    'ytd-guide-entry-renderer:has(a[href^="/playables"])',
    'ytd-mini-guide-entry-renderer:has(a[href^="/playables"])',
    "ytd-watch-flexy #related ytd-horizontal-card-list-renderer",
  ]) {
    assert.ok(shorts.includes(part), part);
  }
  assert.ok(!shorts.includes("start_radio"));
  const radio = cssGroup(css, 'html:not([data-er-page="channel"]');
  assert.ok(radio.includes('yt-lockup-view-model:has(a[href*="start_radio=1"])'));
});

test("end-card hide button goes with the end cards, and HEALTH does not check it", () => {
  const endscreen = cssGroup(hideCss(), "html:not([data-er-show-endscreen])");
  assert.ok(endscreen.includes(".ytp-ce-element"));
  assert.ok(endscreen.includes(".ytp-ce-hide-button-container"));
  assert.ok(!L.HEALTH.watch.some(([, selector]) => selector.includes("ytp-ce-hide-button-container")));
});

test("empty-search suggestions stay hidden whether the box is an input or a textarea", () => {
  const css = hideCss();
  const homeGroup = css.slice(0, css.indexOf("}"));
  assert.ok(homeGroup.includes(':is(input, textarea)[name="search_query"]:placeholder-shown'));
  assert.match(homeGroup, /,\n  #home-container-skeleton\n\) \{/);
  assert.ok(!css.includes('has(input[name="search_query"]'));
});

test("search shelves follow the related filter", () => {
  const css = hideCss();
  const group = cssGroup(css, `html:not([data-er-show-related]) ${L.SEARCH_SHELF}`);
  assert.ok(group.startsWith("html:not([data-er-show-related]) "));
  assert.ok(group.includes(L.SEARCH_SHELF));
  assert.match(L.SEARCH_SHELF, /^ytd-search ytd-item-section-renderer > #contents > /);
  assert.ok(!group.includes(":has("));
  assert.ok(!group.includes("data-er-reveal"));
  assert.doesNotMatch(group, /People|Latest|watched/i);
  assert.deepEqual(L.LEAKS.search.map(([name]) => name), ["related"]);
  const [, leak] = L.LEAKS.search[0];
  assert.ok(leak.includes("ytd-search ytd-shelf-renderer"));
  assert.ok(leak.includes(":not(ytd-expandable-metadata-renderer *)"));
  assert.deepEqual(L.HEALTH.search, [["results", "ytd-search"]]);
});

test("a related card outside the related column on watch pages counts as a leak", () => {
  assert.deepEqual(L.LEAKS.watch.map(([name]) => name), ["related"]);
  const [, leak] = L.LEAKS.watch[0];
  assert.equal(leak, L.WATCH_LEAK);
  assert.ok(leak.startsWith("html:not([data-er-reveal]) "));
  for (const part of ["ytd-watch-grid", "#movie_player", "ytd-playlist-panel-renderer", "ytd-engagement-panel-section-list-renderer", "#player-ads"]) {
    assert.ok(leak.includes(part), part);
  }
  assert.deepEqual(
    L.HEALTH.watch.map(([name]) => name),
    ["player", "related", "comments", "autoplay", "endscreen"],
  );
  assert.deepEqual(L.LEAKS.subs.map(([name]) => name), ["home"]);
});

test("confirmHealth reports a filter only after it fails two checks in a row", () => {
  assert.deepEqual(L.confirmHealth(null, []), { report: [], pending: null });
  assert.deepEqual(L.confirmHealth(null, ["a"]), { report: null, pending: ["a"] });
  assert.deepEqual(L.confirmHealth(["a"], ["a"]), { report: ["a"], pending: null });
  assert.deepEqual(L.confirmHealth(["a", "b"], ["b"]), { report: ["b"], pending: null });
  assert.deepEqual(L.confirmHealth(["a"], ["b"]), { report: null, pending: ["b"] });
  assert.deepEqual(L.confirmHealth(["a"], []), { report: [], pending: null });
  assert.equal(L.HEALTH_DELAY_MS, 6000);
  assert.equal(L.HEALTH_MAX_CHECKS, 3);
});

test("isShortsTitle matches YouTube's own Shorts label in any language", () => {
  assert.equal(L.isShortsTitle("ショート", "ショート"), true);
  assert.equal(L.isShortsTitle("動画", "ショート"), false);
  assert.equal(L.isShortsTitle("shorts", ""), true);
  assert.equal(L.isShortsTitle("short", "shorts"), false);
  assert.equal(L.isShortsTitle(" Shorts ", null), true);
  assert.equal(L.isShortsTitle("", ""), false);
  assert.equal(L.isShortsTitle(undefined, undefined), false);
});

test("browserHint picks the wording for the browser and falls back to neutral", () => {
  const nav = (brands, extra = {}) => ({ userAgentData: { brands: brands.map((brand) => ({ brand, version: "151" })) }, ...extra });
  const style = (value) => ({ getPropertyValue: (name) => (name === "--arc-palette-title" ? value : "") });
  const chromeUa = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
  assert.equal(L.browserHint(nav(["Google Chrome", "Chromium", "Not.A/Brand"]), style("")), "default");
  assert.equal(L.browserHint(nav(["Microsoft Edge", "Chromium"])), "edge");
  assert.equal(L.browserHint(nav(["Brave", "Chromium"], { brave: { isBrave: () => Promise.resolve(true) } })), "default");
  assert.equal(L.browserHint(nav(["Google Chrome", "Chromium"]), style("#123")), "any");
  assert.equal(L.browserHint(nav(["Opera", "Chromium"])), "opera");
  assert.equal(L.browserHint({ userAgent: `${chromeUa} Vivaldi/7.0` }), "any");
  assert.equal(L.browserHint({ userAgent: `${chromeUa} YaBrowser/25.2` }), "yandex");
  assert.equal(L.browserHint(nav(["Chromium", "Not.A/Brand"])), "any");
  assert.equal(L.browserHint({}), "any");
  for (const garbage of [null, undefined, "x", 1, { userAgentData: { brands: "x" } }, { userAgentData: { brands: [null] } }]) {
    assert.doesNotThrow(() => L.browserHint(garbage, garbage));
    assert.equal(L.browserHint(garbage, garbage), "any");
  }
});

test("browserHint never lets a copied Chrome brand outrank a fork signal", () => {
  const throwing = new Proxy({}, { get() { throw new Error("boom"); } });
  assert.equal(L.browserHint(throwing, throwing), "any");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Google Chrome" }] } }, throwing), "default");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Google Chrome" }] }, userAgent: "Chrome/151 OPR/120.0" }), "opera");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Yandex" }, { brand: "Chromium" }] } }), "yandex");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Opera GX" }] } }), "opera");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Google Chrome" }] }, userAgent: "Chrome/151 Vivaldi/7.0" }), "any");
  assert.equal(L.browserHint({ brave: { isBrave() {} } }), "default");
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Google Chrome" }] } }, { getPropertyValue: () => "  " }), "default");
  assert.deepEqual(L.BROWSER_HINTS, ["default", "edge", "opera", "yandex", "any"]);
});

test("shouldShowRate asks once enough errands are done, then never again", () => {
  const date = new Date(2026, 10, 20, 12);
  const days = (counts) => Object.fromEntries(counts.map(([back, done]) => [L.dayKey(new Date(2026, 10, 20 - back)), { done }]));
  const five = days([[0, 2], [3, 1], [12, 2]]);
  assert.equal(L.shouldShowRate(days([[0, 2], [3, 1], [12, 1]]), undefined, date), false);
  assert.equal(L.shouldShowRate(five, undefined, date), true);
  assert.equal(L.shouldShowRate(five, { shown: 2, done: false }, date), true);
  assert.equal(L.shouldShowRate(five, { shown: 3, done: false }, date), false);
  assert.equal(L.shouldShowRate(five, { shown: 0, done: true }, date), false);
  assert.equal(L.shouldShowRate(five, null, date, { warn: true }), false);
  assert.equal(L.shouldShowRate(five, null, date, { noteShown: true }), false);
  assert.equal(L.shouldShowRate(days([[10, 3], [20, 2]]), null, date), false);
  assert.equal(L.shouldShowRate(undefined, undefined, date), false);
  assert.equal(L.shouldShowRate(five, "x", date, null), true);
  assert.equal(L.RATE_MIN_DONE, 5);
  assert.equal(L.NOTE_MAX_SHOWS, 3);
});

test("only a major or minor version change is worth an update note", () => {
  assert.equal(L.isNoteworthyUpdate("0.2.1", "0.3.0"), true);
  assert.equal(L.isNoteworthyUpdate("0.3.0", "0.3.1"), false);
  assert.equal(L.isNoteworthyUpdate("0.3.1", "1.0.0"), true);
  assert.equal(L.isNoteworthyUpdate(undefined, "0.3.0"), false);
  assert.equal(L.isNoteworthyUpdate("x", "0.3.0"), false);
  assert.equal(L.isNoteworthyUpdate("0.3.0", "0.2.9"), false);
  assert.equal(L.isNoteworthyUpdate("0.3.0", "0.3.0"), false);
  assert.equal(L.isNoteworthyUpdate("0.2.1", "y"), false);
  assert.equal(L.noteVersion("0.3.0"), "0.3");
  assert.equal(L.noteVersion("1.12.4.2"), "1.12");
  assert.equal(L.noteVersion("x"), null);
  assert.deepEqual(L.updateNote("0.2.1", "0.3.0"), { version: "0.3", shown: 0 });
  assert.equal(L.updateNote("0.3.0", "0.3.1"), null);
  assert.equal(L.updateNote(undefined, "0.3.0"), null);
});

test("the update note shows up to three times and gives way to a broken filter or a pause", () => {
  const note = { version: "0.3", shown: 0 };
  assert.equal(L.shouldShowUpdateNote(note), true);
  assert.equal(L.shouldShowUpdateNote({ version: "0.3", shown: 2 }), true);
  assert.equal(L.shouldShowUpdateNote({ version: "0.3", shown: 3 }), false);
  assert.equal(L.shouldShowUpdateNote(note, { warn: true }), false);
  assert.equal(L.shouldShowUpdateNote(note, { paused: true }), false);
  assert.equal(L.shouldShowUpdateNote(undefined), false);
  assert.equal(L.shouldShowUpdateNote({ shown: 0 }), false);
  assert.equal(L.changesUrl("0.3"), `${L.SITE_URL}/changes/#v0.3`);
});

test("the pill text is a link that keeps its colour and shows a focus ring", () => {
  const css = hideCss();
  assert.match(css, /#er-pill :is\(span, a\) \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /#er-pill a \{[^}]*color: inherit;[^}]*text-decoration: none;/);
  assert.match(css, /#er-pill a:focus-visible \{[^}]*outline: 2px solid var\(--er-accent\)/);
});
