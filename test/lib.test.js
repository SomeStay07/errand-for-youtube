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

test("watch visits are classified by where the user came from", () => {
  assert.equal(L.classifyVisit("/results", "/watch", "?v=abc"), "intended");
  assert.equal(L.classifyVisit("/feed/subscriptions", "/watch", "?v=abc"), "intended");
  assert.equal(L.classifyVisit("/@channel", "/watch", "?v=abc"), "intended");
  assert.equal(L.classifyVisit(null, "/watch", "?v=abc"), "intended");
  assert.equal(L.classifyVisit("/watch", "/watch", "?v=abc"), "drift");
  assert.equal(L.classifyVisit("/shorts/xyz123", "/watch", "?v=abc"), "drift");
  assert.equal(L.classifyVisit("/watch", "/watch", "?v=abc&list=PL1"), "intended");
  assert.equal(L.classifyVisit("/results", "/feed/subscriptions", ""), null);
  assert.equal(L.classifyVisit("/watch", "/watch", "?v=abc&list=RDabc&start_radio=1"), "drift");
  assert.equal(L.classifyVisit("/watch", "/watch", "?v=abc&list=RDMMabc"), "drift");
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

test("addVisit counts per day and drops days older than the window", () => {
  const today = new Date(2026, 10, 3);
  let stats = { "2026-09-01": { intended: 5, drift: 5 } };
  stats = L.addVisit(stats, "drift", today);
  stats = L.addVisit(stats, "intended", today);
  stats = L.addVisit(stats, "drift", today);
  assert.deepEqual(stats, { "2026-11-03": { intended: 1, drift: 2 } });
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
