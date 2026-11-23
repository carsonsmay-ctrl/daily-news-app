// Scoring, filtering and de-duplication of candidate stories.

/** Parse config/watchlist.txt → [{ name, aliases: [name, ...aliases] }] */
export function parseWatchlist(txt) {
  return String(txt || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      return { name: parts[0], aliases: parts };
    });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOP = new Set("a an the and or of to in on for with at by from as is are was were be after over into its it his her their new says said will could may amid than that this".split(" "));

const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);

export function titleTokens(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

// Words that are often capitalized in headlines but don't identify a specific story.
const GENERIC = new Set(
  ("a an the and or of to in on for with at by from as is are was were be after over into its it his her their our your new says said will " +
    "could may amid than that this how why what who when where here there now just more most first last report reports update weekly daily " +
    "news today week year month inc corp co llc ltd group holdings company companies business firm startup startups deal deals billion million " +
    "acquire acquires acquired acquisition acquisitions buy buys bought sell sells sale sold merger agrees agreement definitive inks signs " +
    "bankruptcy chapter files filing filed seeks protection franchisee restaurant restaurants chain store stores closing closes shuts shutting down " +
    "usda cattle beef feeder live futures prices price market markets cash boxed auction report farm farms farmer farmers farming ranch ranchers " +
    "regenerative agriculture ag agtech tech ai software platform app apps data cloud capital fund funding raises round series seed " +
    "us u.s america american national state states global world north south east west meet up out off top big")
    .split(" "),
);

/**
 * Distinctive tokens for "same story" detection: capitalized words (proper nouns) that are not generic.
 * Multi-word watchlist names collapse to one token so "Bending Spoons" alone doesn't make two different deals look identical.
 */
export function storyTokens(title, watchlist = []) {
  let t = String(title || "");
  for (const w of watchlist) {
    for (const a of w.aliases) {
      if (a.includes(" ")) t = t.replace(new RegExp(escapeRe(a), "gi"), a.replace(/\s+/g, ""));
    }
  }
  const out = new Set();
  for (const raw of t.replace(/[’']s\b/g, "").split(/[^A-Za-z0-9&.-]+/)) {
    const w = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (!w || !/^[A-Z]/.test(w) || /^\d/.test(w)) continue;
    const l = w.toLowerCase();
    if (GENERIC.has(l) || STOP.has(l) || l.length < 3) continue;
    out.add(stem(l));
  }
  return out;
}

export function sameStory(a, b, watchlist = []) {
  const sim = similarity(a.title, b.title);
  if (sim >= 0.6) return true;
  const A = storyTokens(a.title, watchlist);
  const B = storyTokens(b.title, watchlist);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return (shared >= 2 && sim >= 0.15) || (shared >= 1 && sim >= 0.4);
}

export function similarity(a, b) {
  const A = new Set(titleTokens(a));
  const B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  // overlap coefficient blended with Jaccard: robust to one title being a longer rewrite
  const jaccard = inter / (A.size + B.size - inter);
  const overlap = inter / Math.min(A.size, B.size);
  return Math.max(jaccard, overlap * 0.85);
}

export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|cmpid|ref$|oc$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (u.search || "")).toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

// Short terms ("ag", "ai", "app") must match a whole word; longer ones match as a word prefix ("graz" → "grazing").
const wordRe = (term) =>
  new RegExp(`(^|[^a-z0-9])${escapeRe(term.toLowerCase())}${term.length <= 3 ? "(?![a-z0-9])" : ""}`, "i");

export function mentionsWatchlist(text, watchlist) {
  const hits = [];
  for (const w of watchlist) {
    if (w.aliases.some((a) => wordRe(a).test(text))) hits.push(w.name);
  }
  return hits;
}

/**
 * Score one item for a section. Returns { score, reasons } or null when the item should be dropped.
 */
export function scoreItem(item, section, ctx) {
  const { config, watchlist = [], now = new Date(), hoursBack } = ctx;
  const title = item.title || "";
  const desc = item.description || "";
  const titleL = title.toLowerCase();
  const all = `${title} ${desc}`.toLowerCase();

  if (title.length < 20) return null;

  const blocked = (config.blockedSources || []).map((s) => s.toLowerCase());
  if (blocked.includes(String(item.source || "").toLowerCase())) return null;

  for (const p of config.lowValuePatterns || []) {
    if (new RegExp(p, "i").test(title)) return null;
  }

  // recency window
  const ageH = item.published ? (now - item.published) / 36e5 : hoursBack / 2;
  if (ageH > hoursBack || ageH < -6) return null;

  let score = 0;
  const reasons = [];

  const wl = section.useWatchlist ? mentionsWatchlist(all, watchlist) : [];
  if (wl.length) {
    const inTitle = mentionsWatchlist(titleL, watchlist).length > 0;
    score += inTitle ? 12 : 6;
    reasons.push(`watchlist:${wl.join(",")}`);
  }

  if (section.mustMatchAny?.length && !wl.length) {
    if (!section.mustMatchAny.some((t) => wordRe(t).test(all))) return null;
  }

  let kw = 0;
  for (const [term, weight] of Object.entries(section.keywords || {})) {
    const re = wordRe(term);
    if (re.test(titleL)) kw += weight * 2;
    else if (re.test(desc)) kw += weight;
  }
  if (kw === 0 && !wl.length) return null; // not on-topic
  score += Math.min(kw, 24);
  if (kw) reasons.push(`kw:${kw}`);

  const preferred = (config.preferredSources || []).map((s) => s.toLowerCase());
  if (preferred.includes(String(item.source || "").toLowerCase())) {
    score += 3;
    reasons.push("preferred-source");
  }

  // freshness: up to +4 for brand-new stories
  score += Math.max(0, 4 * (1 - Math.max(ageH, 0) / hoursBack));

  // a direct (non-Google) feed for this section is on-topic by construction
  if (item.via && item.via !== "google-news") score += 1;

  return { score: Math.round(score * 10) / 10, reasons };
}

/** Remove near-duplicates; keeps the highest scoring copy. `seen` lets callers dedupe across sections. */
export function dedupe(items, { seen = [], watchlist = [], maxPerSource = 2 } = {}) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept = [];
  const urls = new Set(seen.map((s) => canonicalUrl(s.link)));
  const pool = [...seen];
  for (const it of sorted) {
    const cu = canonicalUrl(it.link);
    if (urls.has(cu)) continue;
    if (pool.some((p) => sameStory(p, it, watchlist))) continue;
    const src = String(it.source || "").toLowerCase();
    if (maxPerSource && kept.filter((k) => String(k.source || "").toLowerCase() === src).length >= maxPerSource) continue;
    urls.add(cu);
    pool.push(it);
    kept.push(it);
  }
  return kept;
}

/** First sentence-ish snippet suitable as a one-line summary; "" if it just repeats the title. */
export function snippetSummary(item, maxLen = 220) {
  let d = String(item.description || "").replace(/\s*(The post .* appeared first on .*|Continue reading.*|Read more.*)$/i, "").trim();
  if (!d) return "";
  if (similarity(d, item.title) > 0.8) return "";
  const m = d.match(/^(.{40,}?[.!?])(\s|$)/);
  if (m && m[1].length <= maxLen) d = m[1];
  if (d.length > maxLen) {
    const cut = d.slice(0, maxLen);
    d = cut.slice(0, cut.lastIndexOf(" ")) + "…";
  }
  return d;
}
