// scripts/collect-public-news.mjs
import path from "node:path";

// src/local-pwa/public-news.mjs
var PUBLIC_SOURCES = [
  { name: "Federal Register", type: "federal", browser: true, url: "https://www.federalregister.gov/api/v1/documents.json?per_page=40&order=newest&conditions%5Bagencies%5D%5B%5D=food-and-drug-administration", terms: "https://www.federalregister.gov/reader-aids/developer-resources/rest-api" },
  { name: "openFDA drug recalls", type: "fda", browser: true, url: "https://api.fda.gov/drug/enforcement.json?limit=40&sort=report_date:desc", terms: "https://open.fda.gov/terms/" },
  { name: "Fierce Pharma manufacturing", url: "https://www.fiercepharma.com/rss/manufacturing/xml" },
  { name: "Fierce Pharma", url: "https://www.fiercepharma.com/rss/pharma/xml", signals: true },
  { name: "Contract Pharma", url: "https://www.contractpharma.com/feed/" },
  { name: "BioPharma Dive", url: "https://www.biopharmadive.com/feeds/news/", signals: true },
  { name: "BioSpace business", url: "https://www.biospace.com/business.rss", signals: true },
  { name: "GEN", url: "https://www.genengnews.com/feed/" }
];
var iso = (x) => {
  const d = new Date(x);
  return x && !Number.isNaN(+d) ? d.toISOString() : null;
};
var clean = (x) => String(x ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
var tag = (s, k) => clean(new RegExp("<" + k + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + k + ">", "i").exec(s)?.[1]);
function parsePublic(text, source, now = (/* @__PURE__ */ new Date()).toISOString()) {
  let rows = [];
  if (source.type === "federal") rows = JSON.parse(text).results.map((r) => ({ source_id: r.document_number, title: r.title, url: r.html_url, published_at: iso(r.publication_date), kind: "permits" }));
  else if (source.type === "fda") rows = JSON.parse(text).results.map((r) => ({ source_id: r.recall_number, title: `${r.recalling_firm}: ${r.product_description}`.slice(0, 280), url: "https://www.accessdata.fda.gov/scripts/ires/?Event=" + encodeURIComponent(r.event_id), published_at: iso(r.report_date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")), date_basis: "FDA report date", kind: "regulatory" }));
  else {
    if (!/<(?:rss|feed|rdf:RDF)\b/i.test(text)) throw new Error("Endpoint did not return an RSS/Atom feed");
    rows = [...text.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map(([, s]) => ({ title: tag(s, "title"), url: tag(s, "link") || /<link[^>]*href=["']([^"']+)/i.exec(s)?.[1], published_at: iso(tag(s, "pubDate") || tag(s, "dc:date") || tag(s, "published")), updated_at: iso(tag(s, "updated")), kind: "news" }));
  }
  return rows.filter((r) => r.title && /^https?:\/\//.test(r.url ?? "")).slice(0, 80).map((r) => ({ ...r, connector: source.name, publisher: source.name, first_seen_at: now, ingested_at: now, public_source: true, date_basis: r.date_basis ?? "Source-supplied publication date", title: clean(r.title) }));
}
async function collectPublic(transport = fetch, { browser = false, now = (/* @__PURE__ */ new Date()).toISOString(), signal } = {}) {
  const records = [], sources = [];
  for (const source of PUBLIC_SOURCES.filter((s) => !browser || s.browser)) {
    try {
      const response = await transport(source.url, { signal: signal ?? AbortSignal.timeout(18e3), headers: { accept: source.type ? "application/json" : "application/rss+xml,application/atom+xml,application/xml,text/xml" }, credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}${response.headers.get("retry-after") ? " \u2014 Retry-After " + response.headers.get("retry-after") : ""}`);
      const body = await response.text();
      if (body.length > 5e6) throw new Error("Response exceeds public-feed limit");
      let rows = parsePublic(body, source, now);
      if (source.signals) rows = rows.filter((r) => /pharma|biotech|manufactur|therap|drug|facility|plant|invest|expand|acquir|fund|clinical/i.test(r.title));
      for (const row of rows) {
        const bytes = new TextEncoder().encode(row.url);
        row.id = "public-" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
        records.push(row);
      }
      sources.push({ name: source.name, url: source.url, at: now, status: rows.length ? "records retrieved" : "responded empty", count: rows.length, terms: source.terms ?? source.url });
    } catch (error) {
      sources.push({ name: source.name, url: source.url, at: now, status: "failed", count: 0, error: String(error.message).slice(0, 250) });
    }
  }
  const unique = new Map(records.map((r) => [r.id, r]));
  return { schema: 1, generated_at: now, scope: "Public endpoint headline/link/date metadata only; not desktop intelligence or complete desktop coverage", records: [...unique.values()], sources };
}

// scripts/collect-public-news.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
var out = process.argv[2];
if (!out) throw new Error("Explicit output path required");
var prior;
try {
  prior = JSON.parse(readFileSync(out, "utf8"));
} catch {
}
var feed = await collectPublic();
var map = new Map((prior?.records ?? []).map((r) => [r.id, r]));
for (const r of feed.records) map.set(r.id, { ...r, first_seen_at: map.get(r.id)?.first_seen_at ?? r.first_seen_at });
feed.records = [...map.values()];
if (!feed.records.length) throw new Error("No verified public records; refusing to publish an empty feed");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(feed, null, 2));
console.log(JSON.stringify({ records: feed.records.length, sources: feed.sources }));
