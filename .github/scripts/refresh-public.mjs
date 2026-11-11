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
  { name: "GEN", url: "https://www.genengnews.com/feed/" },
  { name: "FDA press releases", kind: "fda", country: "United States", signals: true, url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml" },
  { name: "FDA drug news", kind: "fda", country: "United States", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml" },
  { name: "FDA recalls", kind: "fda", country: "United States", signals: true, url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml" },
  { name: "FDA inspection records", kind: "fda", country: "United States", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/ora-foia-electronic-reading-room/rss.xml" },
  { name: "EMA news", kind: "fda", url: "https://www.ema.europa.eu/en/news.xml" },
  { name: "MHRA news", kind: "fda", country: "United Kingdom", url: "https://www.gov.uk/government/organisations/medicines-and-healthcare-products-regulatory-agency.atom" },
  { name: "openFDA drug approvals", type: "drug-approvals", browser: true, country: "United States", url: "https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_type:ORIG+AND+submissions.submission_status:AP&sort=submissions.submission_status_date:desc&limit=80", terms: "https://open.fda.gov/apis/drug/drugsfda/" }
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
  else if (source.type === "drug-approvals") rows = JSON.parse(text).results.flatMap((row) => {
    if (!/^(NDA|BLA)\d+$/.test(row.application_number ?? "") || !row.sponsor_name) return [];
    const original = (row.submissions ?? []).filter((item) => item.submission_type === "ORIG" && item.submission_status === "AP" && /^\d{8}$/.test(item.submission_status_date ?? "")).sort((a, b) => a.submission_status_date.localeCompare(b.submission_status_date))[0];
    if (!original) return [];
    const brands = [...new Set((row.products ?? []).map((product) => product.brand_name).filter(Boolean))];
    return [{
      source_id: row.application_number,
      title: row.sponsor_name + " \xB7 FDA approval " + row.application_number + (brands.length ? ": " + brands.join(", ").slice(0, 100) : ""),
      url: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=" + row.application_number.slice(3),
      published_at: iso(original.submission_status_date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")),
      date_basis: "FDA original approval date",
      kind: "approval"
    }];
  });
  else {
    if (!/<(?:rss|feed|rdf:RDF)\b/i.test(text)) throw new Error("Endpoint did not return an RSS/Atom feed");
    rows = [...text.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map(([, s]) => ({ title: tag(s, "title"), url: tag(s, "link") || /<link[^>]*href=["']([^"']+)/i.exec(s)?.[1], published_at: iso(tag(s, "pubDate") || tag(s, "dc:date") || tag(s, "published")), updated_at: iso(tag(s, "updated")), kind: "news" }));
  }
  return rows.filter((r) => r.title && /^https?:\/\//.test(r.url ?? "")).slice(0, 80).map((r) => ({ ...r, kind: source.kind ?? r.kind, publisher_country: source.country ?? (source.type === "fda" || source.type === "federal" ? "United States" : null), connector: source.name, publisher: source.name, first_seen_at: now, ingested_at: now, public_source: true, date_basis: r.date_basis ?? "Source-supplied publication date", title: clean(r.title) }));
}
async function collectPublic(transport = fetch, { browser = false, now = (/* @__PURE__ */ new Date()).toISOString(), signal } = {}) {
  const records = [], sources = [];
  for (const source of PUBLIC_SOURCES.filter((s) => !browser || s.browser)) {
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        const headers = { accept: source.type ? "application/json" : "application/rss+xml,application/atom+xml,application/xml,text/xml" };
        if (!browser) headers["user-agent"] = "VeronicaPublicFeed/1.0 (+https://github.com/marcopolo2350/veronica-mobile-app)";
        response = await transport(source.url, { signal: signal ?? AbortSignal.timeout(18e3), headers, credentials: "omit", cache: "no-store" });
        if (response.ok || ![404, 408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
        const retry = response.headers.get("retry-after");
        if (retry && (!/^\d+$/.test(retry) || Number(retry) > 3)) break;
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, retry ? Math.max(1, Number(retry)) * 1e3 : 350));
      }
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
feed.sources = feed.sources.map((source) => {
  const previous = prior?.sources?.find((row) => row.name === source.name);
  return { ...source, last_ok_at: source.status !== "failed" ? source.at : previous?.last_ok_at ?? (previous?.status !== "failed" ? previous?.at : null) };
});
var map = new Map((prior?.records ?? []).map((r) => [r.id, r]));
for (const r of feed.records) map.set(r.id, { ...r, first_seen_at: map.get(r.id)?.first_seen_at ?? r.first_seen_at });
feed.records = [...map.values()];
if (!feed.records.length) throw new Error("No verified public records; refusing to publish an empty feed");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(feed, null, 2));
console.log(JSON.stringify({ records: feed.records.length, sources: feed.sources }));
