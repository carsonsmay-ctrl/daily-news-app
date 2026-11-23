import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWatchlist, scoreItem, dedupe, sameStory, snippetSummary, canonicalUrl } from "../scripts/lib/rank.mjs";

const config = {
  blockedSources: ["Spammy News"],
  preferredSources: ["Reuters"],
  lowValuePatterns: ["price target", "\\btop \\d+\\b"],
};
const section = {
  id: "software-deals",
  useWatchlist: true,
  keywords: { acquires: 3, software: 3 },
  mustMatchAny: ["software", "app"],
};
const now = new Date("2026-11-23T13:00:00Z");
const ctx = (extra = {}) => ({ config, watchlist: parseWatchlist("Bending Spoons\nESW Capital | Trilogy"), now, hoursBack: 36, ...extra });
const item = (title, extra = {}) => ({ title, link: `https://ex.com/${encodeURIComponent(title)}`, source: "Some Paper", published: new Date("2026-11-23T08:00:00Z"), description: "", ...extra });

test("parseWatchlist handles comments and aliases", () => {
  const wl = parseWatchlist("# comment\nBending Spoons\n\nESW Capital | Trilogy  # trailing\n");
  assert.deepEqual(wl, [
    { name: "Bending Spoons", aliases: ["Bending Spoons"] },
    { name: "ESW Capital", aliases: ["ESW Capital", "Trilogy"] },
  ]);
});

test("watchlist mentions outrank generic deals", () => {
  const a = scoreItem(item("Bending Spoons acquires Mailchimp from Intuit"), section, ctx());
  const b = scoreItem(item("Acme acquires small software maker for undisclosed sum"), section, ctx());
  assert.ok(a && b);
  assert.ok(a.score > b.score);
  assert.ok(a.reasons.some((r) => r.startsWith("watchlist")));
});

test("aliases count as watchlist hits", () => {
  const r = scoreItem(item("Trilogy picks up another legacy vendor"), section, ctx());
  assert.ok(r && r.reasons.some((x) => x.includes("ESW Capital")));
});

test("drops blocked sources, low-value patterns, stale and off-topic items", () => {
  assert.equal(scoreItem(item("Acme acquires software company XYZ", { source: "Spammy News" }), section, ctx()), null);
  assert.equal(scoreItem(item("Analyst raises price target on software maker"), section, ctx()), null);
  assert.equal(scoreItem(item("Top 10 software acquisitions of the year"), section, ctx()), null);
  assert.equal(scoreItem(item("Acme acquires software company XYZ", { published: new Date("2026-11-20T00:00:00Z") }), section, ctx()), null);
  assert.equal(scoreItem(item("Local bakery wins regional bread award again"), section, ctx()), null);
});

test("short terms in mustMatchAny match whole words only", () => {
  const s = { ...section, useWatchlist: false, mustMatchAny: ["ag"], keywords: { raises: 3 } };
  assert.equal(scoreItem(item("Travel agent startup raises seed round"), s, ctx()), null);
  assert.ok(scoreItem(item("Ag startup raises seed round for soil sensors"), s, ctx()));
});

test("dedupe merges rewrites of the same story but keeps different deals", () => {
  const items = [
    { ...item("Bending Spoons inks definitive agreement to acquire Mailchimp"), score: 20 },
    { ...item("Bending Spoons buys Mailchimp for $3.68 billion, adds another piece to its conglomerate"), score: 18 },
    { ...item("Miro has a new owner: Bending Spoons, the company that buys popular apps"), score: 15 },
    { ...item("StoneX acquires Canadian agtech firm GrainFox"), score: 10 },
    { ...item("StoneX buys Canadian agtech firm GrainFox to deepen farm tools"), score: 9 },
  ];
  const wl = parseWatchlist("Bending Spoons");
  const kept = dedupe(items, { watchlist: wl, maxPerSource: 0 });
  assert.deepEqual(
    kept.map((k) => k.score),
    [20, 15, 10],
  );
});

test("dedupe respects items already used in earlier sections and per-source caps", () => {
  const used = [item("Chapter 11 filing for Big Pizza Chain franchisee")];
  const items = [
    { ...item("Big Pizza Chain franchisee files Chapter 11"), score: 5 },
    { ...item("Unrelated story about cattle prices rising", { source: "A" }), score: 4 },
    { ...item("Another unrelated story about corn futures", { source: "A" }), score: 3 },
    { ...item("Third unrelated story about wheat exports", { source: "A" }), score: 2 },
  ];
  const kept = dedupe(items, { seen: used, maxPerSource: 2 });
  assert.deepEqual(kept.map((k) => k.score), [4, 3]);
});

test("sameStory is false for unrelated bankruptcies", () => {
  assert.equal(
    sameStory(item("Anaheim Craft Brewery Seeks Chapter 11 Bankruptcy Protection"), item("A New York Motion Picture Theater Business Files for Chapter 11 Bankruptcy")),
    false,
  );
});

test("snippetSummary picks the first sentence and ignores title echoes", () => {
  assert.equal(
    snippetSummary({ title: "X", description: "The company raised $12M to expand its soil sensors. It also hired a CFO and plans more." }),
    "The company raised $12M to expand its soil sensors.",
  );
  assert.equal(snippetSummary({ title: "Cattle futures rally on tight supply", description: "Cattle futures rally on tight supply" }), "");
});

test("canonicalUrl strips tracking params", () => {
  assert.equal(canonicalUrl("https://www.ex.com/a/?utm_source=x&id=2#top"), "ex.com/a?id=2");
});
