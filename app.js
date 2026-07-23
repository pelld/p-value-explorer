"use strict";

// ============================================================
// 00. APPLICATION SETTINGS AND SHARED STATE
// ============================================================
const API_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CACHE_PREFIX = "pvalue-explorer:v1:";
const CACHE_DAYS = 7;
const state = { results: null, chartRange: 0.1 };

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

// ============================================================
// 01. PAGE EVENTS
// ============================================================
$("#search-form").addEventListener("submit", event => { event.preventDefault(); runSearch(); });
$$(".topic-chip").forEach(button => button.addEventListener("click", () => { $("#topic").value = button.textContent; runSearch(); }));
$$(".range-button").forEach(button => button.addEventListener("click", () => {
  $$(".range-button").forEach(item => item.classList.toggle("active", item === button));
  state.chartRange = Number(button.dataset.range);
  if (state.results) drawChart(state.results.extractions);
}));
$("#evidence-filter").addEventListener("change", () => state.results && renderEvidence(state.results.extractions));
$("#download-button").addEventListener("click", downloadCsv);

// ============================================================
// 02. PUBMED SEARCH AND LOCAL CACHE
// ============================================================
async function runSearch() {
  const topic = $("#topic").value.trim();
  if (!topic) return;

  const fromYear = $("#from-year").value;
  const toYear = $("#to-year").value;
  if (fromYear && toYear && Number(fromYear) > Number(toYear)) return setStatus("The start year must be before the end year.", true);

  const options = { topic, fromYear, toYear, maxResults: Number($("#max-results").value) };
  const cacheKey = CACHE_PREFIX + JSON.stringify(options).toLowerCase();
  setLoading(true);

  try {
    let data = readCache(cacheKey);
    if (data) {
      setStatus("Loaded from this browser’s seven-day cache.");
    } else {
      setStatus("Searching PubMed…");
      data = await fetchPubMed(options);
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
      setStatus(`Search complete. PubMed returned ${data.articles.length} abstracts.`);
    }
    state.results = data;
    renderResults(data, topic);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "The PubMed search could not be completed. Please try again.", true);
  } finally {
    setLoading(false);
  }
}

async function fetchPubMed({ topic, fromYear, toYear, maxResults }) {
  let term = `(${topic}) AND hasabstract`;
  if (fromYear || toYear) term += ` AND (${fromYear || "1800"}:${toYear || new Date().getFullYear()}[pdat])`;

  const searchParams = new URLSearchParams({ db: "pubmed", term, retmode: "json", retmax: String(maxResults), sort: "pub date", tool: "pvalue_explorer" });
  const searchResponse = await fetch(`${API_BASE}/esearch.fcgi?${searchParams}`);
  if (!searchResponse.ok) throw new Error(`PubMed search failed (${searchResponse.status}).`);
  const searchData = await searchResponse.json();
  const ids = searchData.esearchresult?.idlist || [];
  if (!ids.length) return { articles: [], extractions: [], totalFound: Number(searchData.esearchresult?.count || 0) };

  const fetchParams = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml", rettype: "abstract", tool: "pvalue_explorer" });
  const fetchResponse = await fetch(`${API_BASE}/efetch.fcgi?${fetchParams}`);
  if (!fetchResponse.ok) throw new Error(`PubMed retrieval failed (${fetchResponse.status}).`);
  const xml = new DOMParser().parseFromString(await fetchResponse.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("PubMed returned an unreadable response.");

  const articles = [...xml.querySelectorAll("PubmedArticle")].map(parseArticle).filter(article => article.abstract);
  const extractions = articles.flatMap(article => extractPValues(article));
  return { articles, extractions, totalFound: Number(searchData.esearchresult?.count || 0) };
}

// ============================================================
// 03. PUBMED XML AND P-VALUE EXTRACTION
// ============================================================
function parseArticle(node) {
  const text = selector => node.querySelector(selector)?.textContent?.trim() || "";
  const abstract = [...node.querySelectorAll("AbstractText")].map(part => {
    const label = part.getAttribute("Label");
    return `${label ? `${label}: ` : ""}${part.textContent.trim()}`;
  }).join(" ");
  const year = text("PubDate Year") || text("ArticleDate Year") || (text("MedlineDate").match(/\d{4}/) || [""])[0];
  return { pmid: text("PMID"), title: text("ArticleTitle") || "Untitled article", abstract, year, journal: text("Journal Title") };
}

function extractPValues(article) {
  // Accept common Latin/italic/unicode p notation, comparison operators and values such as .03, 0.03, 3e-4.
  const pattern = /(?:^|[\s([,;:])([pPＰ])\s*(=|<|>|≤|≥|&lt;|&gt;)\s*(\.?\d+(?:\.\d+)?(?:\s*[eE]\s*[+-]?\s*\d+)?)/g;
  const results = [];
  let match;
  while ((match = pattern.exec(article.abstract)) !== null) {
    const operator = match[2].replace("&lt;", "<").replace("&gt;", ">");
    const rawNumber = match[3].replace(/\s/g, "");
    const value = Number(rawNumber.startsWith(".") ? `0${rawNumber}` : rawNumber);
    if (!Number.isFinite(value) || value < 0 || value > 1) continue;
    const pText = `p ${operator} ${rawNumber}`;
    const matchStart = match.index + match[0].indexOf(match[1]);
    const before = article.abstract.slice(Math.max(0, matchStart - 105), matchStart);
    const after = article.abstract.slice(matchStart + match[0].trimStart().length, matchStart + match[0].trimStart().length + 105);
    results.push({ ...article, operator, value, raw: pText, exact: operator === "=", snippetBefore: before, snippetAfter: after });
  }
  return results;
}

// ============================================================
// 04. RESULTS SUMMARY AND HISTOGRAM
// ============================================================
function renderResults(data, topic) {
  const matchedPmids = new Set(data.extractions.map(item => item.pmid));
  const years = data.articles.map(item => Number(item.year)).filter(Boolean);
  $("#result-title").textContent = `“${topic}”`;
  $("#articles-searched").textContent = data.articles.length.toLocaleString("en-GB");
  $("#articles-matched").textContent = matchedPmids.size.toLocaleString("en-GB");
  $("#values-found").textContent = data.extractions.length.toLocaleString("en-GB");
  $("#date-range").textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "Not available";
  $("#results").hidden = false;
  drawChart(data.extractions);
  renderSignal(data.extractions);
  renderEvidence(data.extractions);
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawChart(extractions) {
  const exact = extractions.filter(item => item.exact && item.value <= state.chartRange).map(item => item.value);
  const binSize = state.chartRange === 0.1 ? 0.005 : 0.05;
  const trace = {
    x: exact, type: "histogram", xbins: { start: 0, end: state.chartRange, size: binSize },
    marker: { color: "#0b6666", line: { color: "#fffdf8", width: 1 } },
    hovertemplate: "Range: %{x}<br>Reported values: %{y}<extra></extra>"
  };
  const layout = {
    margin: { l: 48, r: 12, t: 24, b: 52 }, bargap: .05, paper_bgcolor: "transparent", plot_bgcolor: "transparent",
    font: { family: "Inter, system-ui, sans-serif", color: "#607078", size: 11 },
    xaxis: { title: { text: "Reported p-value", standoff: 14 }, range: [0, state.chartRange], dtick: state.chartRange === .1 ? .01 : .1, gridcolor: "#e7e4dd", zeroline: false },
    yaxis: { title: { text: "Count", standoff: 8 }, gridcolor: "#e7e4dd", zeroline: false, rangemode: "tozero" },
    shapes: [
      { type: "rect", x0: .045, x1: .05, y0: 0, y1: 1, yref: "paper", fillcolor: "rgba(231,111,81,.18)", line: { width: 0 } },
      { type: "line", x0: .05, x1: .05, y0: 0, y1: 1, yref: "paper", line: { color: "#e76f51", width: 2, dash: "dot" } }
    ],
    annotations: state.chartRange === .1 ? [{ x: .05, y: 1, yref: "paper", text: "0.05", showarrow: false, xanchor: "left", yanchor: "bottom", font: { color: "#c5533b", size: 11 } }] : []
  };
  Plotly.react("chart", [trace], layout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
}

// ============================================================
// 05. DESCRIPTIVE SIGNAL AROUND 0.05
// ============================================================
function renderSignal(extractions) {
  const values = extractions.filter(item => item.exact).map(item => item.value);
  const below = values.filter(value => value >= .045 && value < .05).length;
  const above = values.filter(value => value >= .05 && value < .055).length;
  const nearby = below + above;
  let title = "Too little evidence";
  let copy = "There are not enough exact values close to 0.05 to describe the local pattern reliably.";
  let icon = "–";

  if (nearby >= 10) {
    const ratio = (below + 1) / (above + 1);
    if (ratio >= 2) {
      title = "Pile-up below 0.05";
      copy = "More exact values were reported immediately below 0.05 than immediately above it. This is a descriptive signal that deserves closer examination.";
      icon = "!";
    } else if (ratio <= .5) {
      title = "No below-threshold pile-up";
      copy = "The narrow band immediately below 0.05 does not contain more exact values than the matching band above it.";
      icon = "✓";
    } else {
      title = "No marked discontinuity";
      copy = "Counts immediately below and above 0.05 are reasonably similar in this abstract sample.";
      icon = "≈";
    }
  }
  $("#signal-title").textContent = title;
  $("#signal-copy").textContent = copy;
  $("#signal-icon").textContent = icon;
  $("#below-count").textContent = below;
  $("#above-count").textContent = above;
}

// ============================================================
// 06. ABSTRACT EVIDENCE AND CSV DOWNLOAD
// ============================================================
function renderEvidence(extractions) {
  const filter = $("#evidence-filter").value;
  const items = extractions.filter(item => filter === "all" || (filter === "exact" ? item.exact : !item.exact));
  if (!items.length) {
    $("#evidence-list").innerHTML = `<p class="empty">${extractions.length ? "No results match this filter." : "No p-values were detected in the retrieved abstracts."}</p>`;
    return;
  }
  $("#evidence-list").innerHTML = items.slice(0, 250).map(item => `
    <article class="evidence-item">
      <span class="p-badge ${item.exact ? "" : "threshold"}">${escapeHtml(item.raw)}</span>
      <div class="evidence-content">
        <h4><a href="https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(item.pmid)}/" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h4>
        <p>…${escapeHtml(item.snippetBefore)}<mark>${escapeHtml(item.raw)}</mark>${escapeHtml(item.snippetAfter)}…</p>
        <span class="evidence-meta">${escapeHtml([item.journal, item.year, `PMID ${item.pmid}`].filter(Boolean).join(" · "))}</span>
      </div>
    </article>`).join("");
}

function downloadCsv() {
  if (!state.results) return;
  const header = ["pmid", "year", "title", "journal", "reported_p", "operator", "numeric_value", "exact", "pubmed_url"];
  const rows = state.results.extractions.map(item => [item.pmid, item.year, item.title, item.journal, item.raw, item.operator, item.value, item.exact, `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`]);
  const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "p-value-explorer-results.csv" });
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 07. SMALL SHARED HELPERS
// ============================================================
function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached && Date.now() - cached.savedAt < CACHE_DAYS * 86400000) return cached.data;
    localStorage.removeItem(key);
  } catch { localStorage.removeItem(key); }
  return null;
}

function setLoading(loading) {
  $("#search-button").disabled = loading;
  $("#search-button").textContent = loading ? "Searching…" : "Explore evidence";
}

function setStatus(message, error = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
