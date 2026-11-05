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

test("report link always opens the feedback form and fills only its four fields", () => {
  for (const form of [undefined, ""]) {
    const url = new URL(L.reportUrl({ version: "0.1.0", browser: "Chrome 142 / ru", page: "watch", missing: ["shorts", "related"] }, form));
    assert.equal(url.origin + url.pathname, "https://docs.google.com/forms/d/e/1FAIpQLScK_SZgLBU4-khfkJgem6Gfdk0JkcnCYq2bATd491NIQ6uAGQ/viewform");
    assert.deepEqual([...url.searchParams.values()], ["pp_url", "0.1.0", "Chrome 142 / ru", "watch", "shorts, related"]);
  }
  const odd = new URL(L.reportUrl({ version: "1", browser: "b" }, "https://example.com/f?a=constructor&b=VERSION"));
  assert.equal(odd.searchParams.get("a"), "constructor");
  assert.equal(odd.searchParams.get("b"), "1");
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
  assert.ok(css.includes(`html:not([data-er-show-home]) ${L.SUBS_SHELF} {`));
  assert.match(L.SUBS_SHELF, /^ytd-browse\[page-subtype="subscriptions"\] /);
  assert.match(L.SUBS_SHELF, /ytd-rich-shelf-renderer:not\(\[is-shorts\]\)/);
  assert.doesNotMatch(L.SUBS_SHELF, /ytd-shelf-renderer|relevant/i);
  assert.deepEqual(L.HEALTH.subs, []);
});

test("the subscriptions leak check is a looser twin of the hiding selector", () => {
  assert.equal(
    L.SUBS_SHELF,
    'ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(> #content > ytd-rich-shelf-renderer:not([is-shorts]))',
  );
  assert.deepEqual(L.LEAKS.subs, [
    ["home", 'ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer:not([is-shorts]))'],
  ]);
  assert.notEqual(L.LEAKS.subs[0][1], L.SUBS_SHELF);
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
  ]) {
    assert.ok(shorts.includes(part), part);
  }
  assert.ok(!shorts.includes("start_radio"));
  assert.ok(!shorts.includes("#"), "the shared Shorts group stays free of IDs");
  assert.ok(css.includes("html:not([data-er-show-shorts]) ytd-watch-flexy #related ytd-horizontal-card-list-renderer {"));
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
  assert.ok(!homeGroup.includes("#"), "the shared home group stays free of IDs");
  assert.match(css, /html:not\(\[data-er-show-home\]\)\s+#home-container-skeleton\s*\{/);
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

test("selectors shared with hide.css are hidden there verbatim, and the watch checks cover both layouts", () => {
  const css = hideCss();
  for (const [name, selector] of Object.entries(L.SELECTORS)) assert.ok(css.includes(selector), name);
  assert.equal(L.SELECTORS.watchScope, ":is(ytd-watch-flexy, ytd-watch-grid)");
  const related = cssGroup(css, "html:not([data-er-show-related]):not([data-er-reveal])");
  assert.ok(related.includes(L.SELECTORS.related));
  for (const part of ["#related", "#bottom-grid", "ytd-watch-next-secondary-results-renderer"]) assert.ok(L.SELECTORS.related.includes(part), part);
  const [, presence] = L.HEALTH.watch.find(([name]) => name === "related");
  assert.equal(presence, `${L.SELECTORS.watchScope} #related`);
  assert.ok(L.WATCH_LEAK.includes(L.SELECTORS.watchScope));
  assert.equal(L.SUBS_SHELF, L.SELECTORS.subsShelf);
  assert.equal(L.SEARCH_SHELF, L.SELECTORS.searchShelf);
});

test("pageType maps every YouTube path the content script cares about", () => {
  const table = {
    "/": "home",
    "/watch": "watch",
    "/live/jfKfPfyJRdk": "watch",
    "/live/jfKfPfyJRdk/": "watch",
    "/live": "other",
    "/live/": "other",
    "/shorts/dQw4w9WgXcQ": "shorts",
    "/shorts": "other",
    "/results": "search",
    "/feed/subscriptions": "subs",
    "/playlist": "playlist",
    "/feed/history": "library",
    "/feed/library": "library",
    "/feed/you": "library",
    "/feed/playlists": "library",
    "/@mkbhd": "channel",
    "/@mkbhd/live": "channel",
    "/@mkbhd/shorts": "channel",
    "/channel/UCBJycsmduvYEL83R_U4JriQ": "channel",
    "/c/mkbhd": "channel",
    "/user/marquesbrownlee": "channel",
    "/feed/trending": "other",
    "/gaming": "other",
    "/embed/x": "other",
  };
  for (const [path, type] of Object.entries(table)) assert.equal(L.pageType(path), type, path);
});

test("watchVideoId reads the id from ?v= or from a /live/ path", () => {
  assert.equal(L.watchVideoId("/watch", "?v=abc123&t=5"), "abc123");
  assert.equal(L.watchVideoId("/watch", ""), null);
  assert.equal(L.watchVideoId("/live/jfKfPfyJRdk", "?si=x"), "jfKfPfyJRdk");
  assert.equal(L.watchVideoId("/live/", ""), null);
  assert.equal(L.watchVideoId("/shorts/abc123", "?v=x"), null);
});

test("parseTime accepts only HH:MM inside a real day", () => {
  assert.equal(L.parseTime("00:00"), 0);
  assert.equal(L.parseTime("09:30"), 570);
  assert.equal(L.parseTime("23:59"), 23 * 60 + 59);
  for (const bad of ["24:00", "99:99", "23:60", "7:30", "07:3", "0730", " 07:30", "07:30 ", "", null, undefined, 730, "aa:bb"]) {
    assert.equal(L.parseTime(bad), null, String(bad));
  }
});

test("settings import keeps valid values, drops bad ones and clamps numbers", () => {
  const time = (value) => L.mergeSettings({ strictStart: value, strictEnd: value });
  for (const bad of ["24:00", "99:99", "23:60", "7:30", "", null, 930]) {
    assert.equal(time(bad).strictStart, L.DEFAULTS.strictStart, String(bad));
    assert.equal(time(bad).strictEnd, L.DEFAULTS.strictEnd, String(bad));
  }
  assert.equal(time("00:00").strictStart, "00:00");
  assert.equal(time("23:59").strictEnd, "23:59");
  const reveal = (value) => L.mergeSettings({ revealSeconds: value }).revealSeconds;
  assert.deepEqual([-5, 0, 3.6, 120, 500, NaN, "30", Infinity].map(reveal), [0, 0, 4, 120, 120, 10, 10, 10]);
  const days = (value) => L.mergeSettings({ strictDays: value }).strictDays;
  assert.deepEqual(days([1, 1, 7, -1]), [1]);
  assert.deepEqual(days([0, 6]), [0, 6]);
  assert.deepEqual(days([]), []);
  assert.deepEqual(days("1,2"), L.DEFAULTS.strictDays);
  assert.equal(L.mergeSettings({ stopAutoplay: "false" }).stopAutoplay, true);
  assert.equal(L.mergeSettings({ stopAutoplay: false }).stopAutoplay, false);
  assert.equal(L.mergeSettings({ endPrompt: 0 }).endPrompt, true);
  assert.equal(L.mergeSettings({ strictSkipUntil: "123" }).strictSkipUntil, undefined);
  for (const junk of [null, undefined, "x", 5, [], true]) assert.deepEqual(L.mergeSettings(junk), L.mergeSettings({}), String(junk));
});

test("settings from 0.1 and 0.2 load without losing choices or keeping stray keys", () => {
  const v01 = {
    mode: "auto",
    strictStart: "08:30",
    strictEnd: "17:00",
    hide: { related: false, endscreen: true, comments: true },
    homeTarget: "subs",
    shortsMode: "block",
    stopAutoplay: false,
    endPrompt: true,
    revealSeconds: 5,
    showShorts: true,
  };
  const s1 = L.mergeSettings(v01);
  assert.deepEqual(s1, {
    ...L.DEFAULTS,
    mode: "auto",
    strictStart: "08:30",
    strictEnd: "17:00",
    hide: { ...L.DEFAULTS.hide, related: false },
    homeTarget: "subs",
    shortsMode: "block",
    stopAutoplay: false,
    revealSeconds: 5,
  });
  const v02 = { ...v01, strictDays: [0, 6], strictSkipUntil: at(1, 17).getTime(), hide: { ...v01.hide, chat: true, metrics: true } };
  const s2 = L.mergeSettings(v02);
  assert.deepEqual(s2.strictDays, [0, 6]);
  assert.equal(s2.strictSkipUntil, at(1, 17).getTime());
  assert.deepEqual(s2.hide, { ...L.DEFAULTS.hide, related: false, chat: true, metrics: true });
  assert.deepEqual(L.mergeSettings(JSON.parse(JSON.stringify(s2))), s2);
});

test("hide keys inherited from Object are never accepted from an import or a patch", () => {
  const imported = L.mergeSettings(JSON.parse('{"hide":{"constructor":true,"toString":false,"__proto__":{"related":false},"comments":false}}'));
  assert.deepEqual(Object.keys(imported.hide).sort(), Object.keys(L.DEFAULTS.hide).sort());
  assert.equal(imported.hide.related, true);
  assert.equal(imported.hide.comments, false);
  const patched = L.patchSettings({}, { hide: { constructor: true, hasOwnProperty: false } });
  assert.deepEqual(Object.keys(patched.hide).sort(), Object.keys(L.DEFAULTS.hide).sort());
});

test("a schedule whose start equals its end is never strict", () => {
  const s = L.mergeSettings({ mode: "auto", strictStart: "10:00", strictEnd: "10:00", strictDays: [0, 1, 2, 3, 4, 5, 6] });
  for (const hh of [0, 9, 10, 11, 23]) assert.equal(L.isStrict(s, at(1, hh)), false, String(hh));
});

test("turning strict off ends the skip at the next strictEnd on both DST change days in Madrid", () => {
  inZone("Europe/Madrid", () => {
    const night = L.mergeSettings({ mode: "auto", strictStart: "22:00", strictEnd: "06:00", strictDays: [6] });
    const autumn = L.endStrict(night, new Date(2026, 9, 24, 23));
    assert.equal(autumn.strictSkipUntil, new Date(2026, 9, 25, 6).getTime());
    assert.equal(L.nextStrictEnd(night, new Date(2026, 9, 24, 23)), new Date(2026, 9, 25, 6).getTime());
    assert.equal(L.nextStrictEnd(night, new Date(2026, 9, 25, 6)), new Date(2026, 9, 26, 6).getTime());
    assert.equal(L.isStrict(autumn, new Date(2026, 9, 25, 5, 30)), false);
    const spring = L.endStrict(night, new Date(2026, 2, 28, 23));
    assert.equal(spring.strictSkipUntil, new Date(2026, 2, 29, 6).getTime());
    assert.equal(L.isStrict(spring, new Date(2026, 2, 29, 5, 30)), false);
    const longDay = L.mergeSettings({ mode: "auto", strictStart: "09:00", strictEnd: "08:59", strictDays: [0, 1, 2, 3, 4, 5, 6] });
    const skip = L.endStrict(longDay, new Date(2026, 9, 24, 9));
    assert.ok(skip.strictSkipUntil - new Date(2026, 9, 24, 9).getTime() > 24 * 60 * 60 * 1000);
    assert.equal(L.isSkipped(skip, new Date(2026, 9, 24, 9)), true);
    assert.equal(L.isStrict(skip, new Date(2026, 9, 25, 8)), false);
    assert.equal(L.isStrict(skip, new Date(2026, 9, 25, 9)), true);
  });
});

test("stats windows end exactly at 7 and 30 days", () => {
  const today = new Date(2026, 10, 20, 12);
  const back = (n) => L.dayKey(new Date(2026, 10, 20 - n));
  assert.deepEqual(L.errandTotals({ [back(6)]: { done: 1, closed: 1 }, [back(7)]: { done: 5, closed: 5 } }, today), { done: 1, closed: 1 });
  const kept = L.addCount({ [back(29)]: { done: 1 }, [back(30)]: { done: 1 } }, "done", today);
  assert.deepEqual(Object.keys(kept).sort(), [back(29), back(0)].sort());
});

test("the diagnostics log keeps the newest entries in order and the report shows the newest first", () => {
  let log = [];
  for (let i = 0; i < 40; i += 1) log = L.appendLog(log, { page: `p${i}`, missing: ["related"] }, 1_700_000_000_000 + i * 60_000);
  assert.deepEqual(log.map((e) => e.page), Array.from({ length: L.LOG_LIMIT }, (_, i) => `p${i + 10}`));
  const text = L.formatDiagnostics(log, L.mergeSettings());
  const [, first, second] = text.split("; ");
  assert.ok(first.endsWith("p39:related"), first);
  assert.ok(second.endsWith("p38:related"), second);
  const long = Array.from({ length: 30 }, (_, i) => ({ t: 1_700_000_000_000 + i, page: "x".repeat(100), missing: ["related"] }));
  assert.equal(L.formatDiagnostics(long, L.mergeSettings()).length, 600);
});

test("formatDiagnostics skips malformed log entries instead of throwing", () => {
  const log = [null, 1, "x", {}, { t: "x", missing: [] }, { t: NaN, missing: [] }, { t: 1e20, missing: [] }, { t: 0 }, { t: 0, missing: "a" }, { t: 0, page: "watch", missing: ["ok"] }];
  assert.doesNotThrow(() => L.formatDiagnostics(log, L.mergeSettings()));
  const text = L.formatDiagnostics(log, L.mergeSettings());
  assert.deepEqual(text.split("; ").slice(1), ["01-01T00:00 watch:ok"]);
  assert.doesNotThrow(() => L.formatDiagnostics("x", undefined));
  assert.doesNotThrow(() => L.formatDiagnostics(undefined, null));
});

test("strict mode forces the default filters but leaves opt-in ones as the user set them", () => {
  const off = L.hiddenParts(L.mergeSettings({ hide: { chat: false, metrics: false, notifications: false, thumbs: false } }), true);
  for (const key of L.OPT_IN) assert.equal(off[key], false, key);
  const on = L.hiddenParts(L.mergeSettings({ hide: { chat: true } }), true);
  assert.equal(on.chat, true);
});

test("Shorts redirect keeps the id, drops a stray v and ignores short ids", () => {
  assert.equal(L.shortsToWatch("/shorts/abc_DEF-12", "?v=x&t=5"), "/watch?v=abc_DEF-12&t=5");
  assert.equal(L.shortsToWatch("/shorts/abc_DEF-12/"), "/watch?v=abc_DEF-12");
  assert.equal(L.shortsToWatch("/shorts/a"), null);
  assert.equal(L.shortsToWatch("/shorts/abcde"), null);
  assert.equal(L.shortsToWatch("/shorts/abcdef"), "/watch?v=abcdef");
});

test("pause, pause start, strict exit and strict skip hold their exact edges", () => {
  const now = 10_000_000;
  assert.equal(L.isPaused(now + L.PAUSE_MS, now), true);
  assert.equal(L.isPauseStarting(now + L.PAUSE_WAIT_S * 1000 + 1000, now), true);
  assert.equal(L.isPauseStarting(now + L.PAUSE_WAIT_S * 1000 + 1001, now), false);
  const strict = L.mergeSettings({ mode: "strict" });
  const date = new Date(now);
  assert.equal(L.strictExit(strict, now - 60_000, date), "due");
  assert.equal(L.strictExit(strict, now - 60_001, date), "none");
  const auto = { mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [1] };
  const d = at(1, 10);
  assert.equal(L.isSkipped(L.mergeSettings({ ...auto, strictSkipUntil: d.getTime() + 25 * 60 * 60 * 1000 }), d), true);
  assert.equal(L.isSkipped(L.mergeSettings({ ...auto, strictSkipUntil: d.getTime() + 25 * 60 * 60 * 1000 + 1 }), d), false);
  assert.equal(L.isSkipped(L.mergeSettings({ ...auto, strictSkipUntil: d.getTime() }), d), false);
});

test("version and browser edge cases", () => {
  assert.equal(L.isNoteworthyUpdate("1.0.0", "0.5.0"), false);
  assert.equal(L.noteVersion("0.3.0-beta"), null);
  assert.equal(L.browserHint({ userAgentData: { brands: [{ brand: "Microsoft Edge WebView2" }] } }), "any");
  assert.equal(L.browserHint({ userAgent: "Opera/9.80 (Macintosh; Intel Mac OS X 10.15) Presto/2.12" }), "opera");
});

test("patchSettings clamps a reveal delay into range and rejects everything else it cannot take as is", () => {
  const stored = { revealSeconds: 30, strictDays: [1, 2] };
  assert.equal(L.patchSettings(stored, { revealSeconds: 500 }).revealSeconds, 120);
  assert.equal(L.patchSettings(stored, { revealSeconds: -3 }).revealSeconds, 0);
  assert.equal(L.patchSettings(stored, { revealSeconds: 4.6 }).revealSeconds, 5);
  assert.equal(L.patchSettings(stored, { revealSeconds: "60" }).revealSeconds, 30);
  assert.equal(L.patchSettings(stored, { revealSeconds: NaN }).revealSeconds, 30);
  assert.deepEqual(L.patchSettings(stored, { strictDays: [1, 1, 2] }).strictDays, [1, 2]);
  assert.deepEqual(L.patchSettings(stored, { strictDays: [9] }).strictDays, [1, 2]);
  assert.equal(L.patchSettings(stored, { strictEnd: "24:00" }).strictEnd, L.DEFAULTS.strictEnd);
});

test("English-only Shorts rules are a fallback: each has a language-free twin in the Shorts group", () => {
  const shorts = cssGroup(hideCss(), "html:not([data-er-show-shorts])");
  const twins = {
    'ytd-guide-entry-renderer:has(a[title="Shorts"])': 'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]': 'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])',
    'yt-tab-shape[tab-title="Shorts"]': "[data-er-shorts]",
  };
  for (const [english, twin] of Object.entries(twins)) {
    assert.ok(shorts.includes(english), english);
    assert.ok(shorts.includes(twin), twin);
  }
  assert.equal(L.isShortsTitle("Shorts", "Короткие видео"), true);
  assert.equal(L.isShortsTitle("Короткие видео", "Короткие видео"), true);
});

test("searchUrl encodes the errand text", () => {
  assert.equal(L.searchUrl("swift & ui?"), "/results?search_query=swift%20%26%20ui%3F");
});

test("translator passes substitutions to getMessage as strings", () => {
  const calls = [];
  const t = L.translator({ getMessage: (key, subs) => (calls.push([key, subs]), `${key}:${subs.join(",")}`) });
  assert.equal(t("statusPaused", 5, "x"), "statusPaused:5,x");
  assert.deepEqual(calls, [["statusPaused", ["5", "x"]]]);
});

test("localizeDocument sets lang, direction and every data-i18n text", () => {
  const nodes = [{ dataset: { i18n: "a" }, textContent: "" }, { dataset: { i18n: "b" }, textContent: "" }];
  const doc = { documentElement: {}, querySelectorAll: (sel) => (sel === "[data-i18n]" ? nodes : []) };
  L.localizeDocument(doc, (key) => (key === "@@bidi_dir" ? "rtl" : key.toUpperCase()), "de");
  assert.deepEqual(doc.documentElement, { lang: "de", dir: "rtl" });
  assert.deepEqual(nodes.map((n) => n.textContent), ["A", "B"]);
});

test("clock and clockOf follow the UI language's hour style", () => {
  assert.equal(L.clockOf("23:59", "en-US"), "11:59 PM".replace(" ", L.clockOf("23:59", "en-US").includes(" ") ? " " : " "));
  assert.match(L.clockOf("23:59", "en-US"), /^11:59\sPM$/);
  assert.equal(L.clockOf("23:59", "ru"), "23:59");
  assert.equal(L.clockOf("07:05", "de"), "7:05");
  const ms = new Date(2026, 0, 1, 9, 30).getTime();
  assert.equal(L.clock(ms, "ru"), "9:30");
  assert.equal(L.clock(new Date(ms), "ru"), "9:30");
});

test("browserLabel names the real brand, falls back to the user agent and never throws", () => {
  const brands = (...list) => ({ userAgentData: { brands: list.map(([brand, version]) => ({ brand, version })) } });
  assert.equal(L.browserLabel(brands(["Not.A/Brand", "99"], ["Chromium", "151"], ["Google Chrome", "151"]), "ru"), "Google Chrome 151 / ru");
  assert.equal(L.browserLabel({ userAgent: "Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/140.0" }, "de"), "Firefox/140 / de");
  assert.equal(L.browserLabel({ ...brands(["Chromium", "151"]), userAgent: "Mozilla/5.0 Edg/151.0" }, "en"), "Edg/151 / en");
  assert.equal(L.browserLabel({}, "en"), " / en");
  const throwing = new Proxy({}, { get() { throw new Error("boom"); } });
  for (const junk of [null, undefined, "x", throwing, { userAgentData: { brands: [null, 1] } }]) {
    assert.doesNotThrow(() => L.browserLabel(junk, "en"));
  }
});

test("isFirefox looks for getBrowserInfo, not for a browser global", () => {
  assert.equal(L.isFirefox({ browser: { runtime: { getBrowserInfo() {} } } }), true);
  assert.equal(L.isFirefox({ browser: { runtime: {} } }), false);
  assert.equal(L.isFirefox({}), false);
  assert.equal(L.isFirefox(undefined), false);
  assert.equal(L.isFirefox(new Proxy({}, { get() { throw new Error("boom"); } })), false);
});

test("health skips comments on live streams and player checks until the video can play", () => {
  const names = (opts) => L.healthChecks("watch", { related: true, endscreen: true, comments: true, autoplay: true }, opts).map(([name]) => name);
  assert.deepEqual(names(), ["player", "related", "comments", "autoplay", "endscreen"]);
  assert.deepEqual(names({ live: true }), ["player", "related", "autoplay", "endscreen"]);
  assert.deepEqual(names({ playable: false }), ["player", "related", "comments"]);
  assert.deepEqual(names({ live: true, playable: false }), ["player", "related"]);
  assert.deepEqual(L.healthChecks("watch", { related: false, comments: false, endscreen: false, autoplay: false }, { live: true, playable: false }).map(([n]) => n), ["player"]);
  assert.deepEqual(L.healthChecks("search", {}, { live: true, playable: false }).map(([n]) => n), ["results"]);
});

test("reveal and comments buttons are wanted only on a watch page with the part hidden, outside strict and pause", () => {
  const state = { hide: { related: true, comments: false }, strict: false, paused: false };
  assert.equal(L.wantsButton("related", "watch", state), true);
  assert.equal(L.wantsButton("comments", "watch", state), false);
  assert.equal(L.wantsButton("related", "home", state), false);
  assert.equal(L.wantsButton("related", "watch", { ...state, strict: true }), false);
  assert.equal(L.wantsButton("related", "watch", { ...state, paused: true }), false);
  assert.equal(L.wantsButton("related", "watch"), false);
  assert.equal(L.wantsButton("related", "watch", { hide: null }), false);
});
