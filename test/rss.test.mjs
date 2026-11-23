import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, googleNewsUrl, stripHtml } from "../scripts/lib/rss.mjs";

test("parses Google News RSS and splits the source off the title", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>
    <item><title>Intuit offloads Mailchimp to Bending Spoons - Marketing Dive</title>
    <link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Mon, 23 Nov 2026 12:00:00 GMT</pubDate>
    <description>&lt;a href="x"&gt;Intuit offloads&lt;/a&gt;</description>
    <source url="https://www.marketingdive.com">Marketing Dive</source></item></channel></rss>`;
  const [it] = parseFeed(xml, { isGoogleNews: true });
  assert.equal(it.title, "Intuit offloads Mailchimp to Bending Spoons");
  assert.equal(it.source, "Marketing Dive");
  assert.equal(it.description, "");
  assert.equal(it.published.toISOString(), "2026-11-23T12:00:00.000Z");
});

test("parses a regular RSS feed with HTML descriptions", () => {
  const xml = `<rss><channel><title>AgFunderNews</title><item><title>Startup raises $5M</title><link>https://agfundernews.com/x</link>
    <pubDate>Mon, 23 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>The startup &amp; its <b>robots</b> raised money.</p>]]></description></item></channel></rss>`;
  const [it] = parseFeed(xml, { feedUrl: "https://agfundernews.com/feed" });
  assert.equal(it.source, "AgFunderNews");
  assert.equal(it.description, "The startup & its robots raised money.");
});

test("parses Atom feeds", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Hello world post</title>
    <link rel="alternate" href="https://blog.example/hello"/><updated>2026-11-23T09:00:00Z</updated><summary>Short summary.</summary></entry></feed>`;
  const [it] = parseFeed(xml);
  assert.equal(it.link, "https://blog.example/hello");
  assert.equal(it.description, "Short summary.");
});

test("googleNewsUrl adds a time filter", () => {
  assert.match(googleNewsUrl('"Bending Spoons"', {}, 2), /q=%22Bending%20Spoons%22%20when%3A2d/);
});

test("stripHtml decodes entities", () => {
  assert.equal(stripHtml("<p>A&nbsp;&amp;&#39;B</p>"), "A &'B");
});
