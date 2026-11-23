// Fetch and parse RSS 2.0 / Atom feeds into a common item shape.
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
});

const UA = "Mozilla/5.0 (compatible; DailyBriefingBot/1.0; personal news reader)";

export function googleNewsUrl(query, { hl = "en-US", gl = "US", ceid = "US:en" } = {}, days = 2) {
  const q = `${query} when:${days}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
}

export async function fetchText(url, { timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? "");
  return "";
};

export function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Parse feed XML into [{title, link, source, published, description}] */
export function parseFeed(xml, { feedUrl = "", isGoogleNews = false } = {}) {
  const doc = parser.parse(xml);
  const out = [];

  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    const channelTitle = stripHtml(text(ch.title));
    const items = [].concat(ch.item || []);
    for (const it of items) {
      let title = stripHtml(text(it.title));
      const link = text(it.link).trim() || text(it.guid).trim();
      let source = stripHtml(text(it.source)) || channelTitle || hostName(link);
      if (isGoogleNews) {
        // Google News titles look like "Headline - Source Name"
        const idx = title.lastIndexOf(" - ");
        if (idx > 0) {
          const suffix = title.slice(idx + 3).trim();
          if (!text(it.source) || suffix.toLowerCase() === source.toLowerCase()) source = source || suffix;
          if (suffix.toLowerCase() === source.toLowerCase()) title = title.slice(0, idx).trim();
        }
      }
      const rawDesc = text(it.description) || text(it["content:encoded"]);
      out.push({
        title,
        link,
        source,
        published: parseDate(text(it.pubDate) || text(it["dc:date"])),
        description: isGoogleNews ? "" : truncate(stripHtml(rawDesc), 400),
        via: isGoogleNews ? "google-news" : feedUrl,
      });
    }
  } else if (doc.feed) {
    const feedTitle = stripHtml(text(doc.feed.title));
    for (const e of [].concat(doc.feed.entry || [])) {
      const links = [].concat(e.link || []);
      const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") || links[0] || {};
      const link = alt["@href"] || text(alt);
      out.push({
        title: stripHtml(text(e.title)),
        link,
        source: feedTitle || hostName(link),
        published: parseDate(text(e.published) || text(e.updated)),
        description: truncate(stripHtml(text(e.summary) || text(e.content)), 400),
        via: feedUrl,
      });
    }
  }
  return out.filter((i) => i.title && i.link);
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function truncate(s, n) {
  if (!s || s.length <= n) return s || "";
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}
