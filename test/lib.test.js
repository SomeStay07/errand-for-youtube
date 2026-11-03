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
