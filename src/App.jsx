import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  navy:    "#0D1B2A", navyMid: "#112233", navyLt:  "#1A3045",
  teal:    "#00C9B1", tealDk:  "#009E8C", tealLt:  "#E0FAF7",
  white:   "#FFFFFF", offWhite:"#F5F9F8", slate:   "#64748B",
  silver:  "#CBD5E1", muted:   "#94A3B8",
  green:   "#22C55E", greenLt: "#DCFCE7",
  amber:   "#F59E0B", amberLt: "#FEF3C7",
  red:     "#EF4444", redLt:   "#FEE2E2",
  purple:  "#8B5CF6", purpleLt:"#EDE9FE",
  orange:  "#F97316", orangeLt:"#FFF7ED",
  border:  "rgba(0,201,177,0.15)",
};

// ─── API CALL ────────────────────────────────────────────────────────────────
// Calls /api/claude which proxies to Anthropic (via Vercel edge fn in prod,
// via Vite proxy in dev). Streams response and calls onChunk with accumulated text.
async function callClaude(messages, system, onChunk) {
  const payload = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4000,
    system,
    messages,
    stream: true,
  };

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errMsg = `API error ${res.status}`;
    try {
      const errBody = await res.text();
      const parsed = JSON.parse(errBody);
      errMsg = parsed?.error?.message || parsed?.error || errBody || errMsg;
    } catch { /* use default */ }
    throw new Error(errMsg);
  }

  let full = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const d = JSON.parse(payload);
        if (d.type === "content_block_delta" && d.delta?.text) {
          full += d.delta.text;
          onChunk(full);
        }
      } catch { /* skip malformed SSE lines */ }
    }
  }

  // Handle any remaining buffer
  if (buffer.startsWith("data: ")) {
    try {
      const d = JSON.parse(buffer.slice(6).trim());
      if (d.type === "content_block_delta" && d.delta?.text) {
        full += d.delta.text;
        onChunk(full);
      }
    } catch { /* skip */ }
  }

  return full;
}

// ─── AGENT CONFIGS ───────────────────────────────────────────────────────────
// Keys here are the IDs used throughout the pipeline. "writer" is the key
// (previously mismatched as "write" in pipeline calls).
const AGENTS = {
  serp: {
    id: "serp", label: "SERP intelligence", short: "SERP",
    color: T.teal, colorLt: T.tealLt, icon: "◈",
    system: `You are a senior SEO analyst for Indian fintech content. Analyse the competitive landscape for a keyword.
Return ONLY valid JSON — no markdown fences, no explanation, no preamble — with this exact shape:
{"keyword":"...","avg_word_count":1800,"top_pages":[{"title":"...","domain":"smallcase.com/learn","headings":["H2 one","H2 two","H2 three"],"word_count":2000,"top_keywords":["kw1","kw2","kw3"]}],"content_gaps":["gap1","gap2","gap3","gap4","gap5"],"semantic_keywords":["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8","kw9","kw10"],"competitor_faqs":["Q1?","Q2?","Q3?","Q4?","Q5?"]}
Use realistic Indian fintech domains: smallcase.com/learn, tickertape.in/blog, etmoney.com/blog, groww.in/blog, zerodha.com/varsity. Include 5 top_pages, 5 content_gaps, 10 semantic_keywords, 5 competitor_faqs.`,
  },
  brief: {
    id: "brief", label: "Content brief", short: "Brief",
    color: T.purple, colorLt: T.purpleLt, icon: "◉",
    system: `You are a content strategist at Kalpi, an Indian investing app for beginners (22–35 year old urban Indians). Turn SEO data into a structured content brief.
Return ONLY valid JSON — no markdown fences, no explanation:
{"target_keyword":"...","kalpi_angle":"one-sentence unique POV vs competitors","search_intent":"informational","target_word_count":1600,"required_h2s":["H2 one","H2 two","H2 three","H2 four","H2 five","H2 six"],"semantic_variants":["kw1","kw2","kw3","kw4","kw5"],"internal_links":[{"anchor":"link text","url":"/blog/slug","note":"why link here — must be contextually relevant"}],"external_links":[{"anchor":"link text","url":"https://full-url.com","authority":"source name"}],"faq_questions":["Q1?","Q2?","Q3?","Q4?","Q5?"],"image_suggestions":["chart showing X","infographic about Y","screenshot of Z"],"meta_description":"155-char meta description here","cta":"specific Kalpi app call to action"}

INTERNAL LINK RULES: Generate 3-5 internal links to real Kalpi blog pages. Use these real Kalpi URLs:
/blog/what-is-sip, /blog/mutual-funds-for-beginners, /blog/elss-tax-saving, /blog/index-funds-india,
/blog/how-to-start-investing, /blog/nav-meaning, /blog/direct-vs-regular-mutual-funds,
/blog/sip-calculator, /blog/best-mutual-funds-india, /blog/stock-market-basics.
Choose the most contextually relevant ones for the topic.

EXTERNAL LINK RULES: Generate 3-5 external links to authoritative Indian financial sources. Use ONLY these real URLs:
- AMFI: https://www.amfiindia.com
- SEBI: https://www.sebi.gov.in
- RBI: https://www.rbi.org.in
- NSE India: https://www.nseindia.com
- BSE India: https://www.bseindia.com
- Income Tax India: https://www.incometax.gov.in
- NPCI (UPI/payments): https://www.npci.org.in
- Zerodha Varsity: https://zerodha.com/varsity
- PFRDA (NPS): https://www.pfrda.org.in
Choose the most relevant for the topic. Use descriptive anchors like "SEBI regulations", "AMFI data", "NSE listed funds".`,
  },
 writer: {
    id: "writer", label: "Writer", short: "Writer",
    color: T.green, colorLt: T.greenLt, icon: "✦",
    system: `You are Kalpi's lead content writer. Write clear, engaging investing articles for first-time investors aged 22–35 in urban India.
Rules: open with a relatable hook, use short paragraphs (2–3 sentences), use concrete numbers, never use jargon without explaining it, mention SEBI where relevant, end with a Kalpi CTA.

LINK RULES — CRITICAL: You MUST embed every link from the brief into the article body as markdown links.
- Internal links: use as [anchor text](/blog/slug) naturally within sentences. Example: "You can start with a [SIP calculator](/blog/sip-calculator) to plan your investment."
- External links: use as [anchor text](https://full-url.com) when citing facts, regulations, or data. Example: "According to [AMFI](https://amfiindia.com), over 9 crore SIP accounts are active."
- Never list links separately — weave them into the prose naturally.
- Use EVERY internal and external link provided. Do not skip any.

Format: Full markdown. Include <!-- META: desc --> at top, ## H2 headings, <!-- IMAGE: desc --> placeholders, ## Frequently Asked Questions section, and at the end.`
  },
  factcheck: {
    id: "factcheck", label: "Fact checker", short: "Facts",
    color: T.amber, colorLt: T.amberLt, icon: "⬡",
    system: `You are a financial fact-checker for Indian investing content. Review articles for accuracy.
Return ONLY valid JSON — no markdown fences, no explanation:
{"verdict":"pass","score":88,"issues":[{"type":"regulatory","text":"exact quote from article","fix":"correction","severity":"high"}],"required_disclaimers":["disclaimer text"],"summary":"one sentence summary of findings"}
Check: SEBI rules, ELSS limit (₹1.5L under 80C), realistic return ranges (equity 10–15% long term), missing mutual fund risk disclaimers, lock-in periods, expense ratios.`,
  },
  seo: {
    id: "seo", label: "SEO scorer", short: "SEO",
    color: T.orange, colorLt: T.orangeLt, icon: "◎",
    system: `You are an SEO specialist for fintech content. Score the article 0–100 on SEO optimisation.
Return ONLY valid JSON — no markdown fences, no explanation:
{"total_score":82,"breakdown":{"keyword_density":18,"structure":14,"meta_quality":9,"internal_linking":13,"external_linking":9,"faq_schema":14,"readability":5},"keyword_density_pct":1.3,"readability_grade":"Grade 9","title_tag":"Optimised Title | Kalpi","slug":"url-slug-here","schema_json":{"@context":"https://schema.org","@type":"Article","headline":"...","description":"...","author":{"@type":"Organization","name":"Kalpi"},"publisher":{"@type":"Organization","name":"Kalpi"}},"og_tags":{"og:title":"...","og:description":"...","og:type":"article"},"top_issues":["issue 1","issue 2","issue 3"],"verdict":"Good — ready to publish with minor fixes"}
Be realistic with scores. Most first drafts score 60–80.`,
  },
  cluster: {
    id: "cluster", label: "Cluster planner", short: "Cluster",
    color: T.teal, colorLt: T.tealLt, icon: "⬢",
    system: `You are an SEO topic cluster strategist for Kalpi, an Indian investing app. Plan a complete hub-and-spoke content cluster.
Return ONLY valid JSON — no markdown fences, no explanation:
{"pillar_keyword":"...","pillar_title":"...","pillar_word_count":3000,"satellites":[{"keyword":"...","title":"...","intent":"informational","monthly_searches":2400,"difficulty":"low","angle":"unique angle"}],"total_articles":11,"cluster_rationale":"why this cluster builds topical authority","internal_link_map":[{"from":"satellite title","to":"pillar or another satellite","anchor":"suggested anchor text"}]}
Generate exactly 10 satellites covering different intents (informational, commercial, transactional), difficulties (low/medium/high), and angles. Focus on Indian investing context.`,
  },
  refresh: {
    id: "refresh", label: "Refresh monitor", short: "Refresh",
    color: T.green, colorLt: T.greenLt, icon: "↻",
    system: `You are an SEO performance analyst. Assess a published article's ranking health and recommend improvements.
Return ONLY valid JSON — no markdown fences, no explanation:
{"health_score":72,"ranking_estimate":"top 10","trajectory":"stable","decline_reasons":["reason 1","reason 2"],"recommended_action":"refresh_content","priority":"medium","refresh_tasks":[{"task":"specific fix","impact":"high","effort":"2hr"}],"new_keywords_to_add":["kw1","kw2"],"sections_to_update":["section heading"],"estimated_traffic_gain":"+15–25% within 60 days"}`,
  },
  visuals: {
    id: "visuals", label: "Visual engine", short: "Visuals",
    color: "#EC4899", colorLt: "#FCE7F3", icon: "◐",
    system: `You are a visual content strategist for investing blogs. Analyse the article and generate image and chart specifications.
Return ONLY valid JSON — no markdown fences, no explanation — with this exact shape:
{
  "hero_image": {
    "query": "search query for Unsplash (3-5 words, relevant to article topic)",
    "alt": "descriptive alt text for SEO"
  },
  "section_images": [
    {
      "after_heading": "exact H2 heading text from article this image should appear after",
      "query": "search query for Unsplash photo",
      "alt": "descriptive alt text"
    }
  ],
  "charts": [
    {
      "after_heading": "exact H2 heading text from article this chart goes after",
      "type": "line|bar|pie|doughnut",
      "title": "chart title",
      "alt": "descriptive alt text for screen readers",
      "data": {
        "labels": ["Label 1","Label 2","Label 3","Label 4","Label 5"],
        "datasets": [
          {
            "label": "Dataset name",
            "data": [10,20,30,40,50],
            "color": "#00C9B1"
          }
        ]
      },
      "caption": "Source or explanation below chart"
    }
  ]
}

Rules:
- Generate exactly 1 hero_image, 2-3 section_images, and 2-3 charts.
- For section_images, match after_heading to EXACT H2 text from the article.
- Unsplash queries: use descriptive terms (e.g. "indian person investing laptop", "stock market chart screen", "young professional saving money"). Avoid abstract terms.
- Charts must use REALISTIC data relevant to Indian investing. Examples:
  * SIP growth over 10/15/20 years (line chart with realistic CAGR 12%)
  * Asset allocation pie chart (equity/debt/gold/cash)
  * Expense ratio comparison bar chart across fund types
  * Mutual fund category returns bar chart
  * Power of compounding line chart
- Chart data values must be numerically realistic and educational.
- Each chart needs a different type if possible (mix line, bar, pie).
- Colors: use these hex values: #00C9B1 (teal), #8B5CF6 (purple), #F59E0B (amber), #22C55E (green), #EF4444 (red), #3B82F6 (blue).
- For multi-dataset charts use contrasting colors from the list above.`,
  },
  router: {
    id: "router", label: "Intent router", short: "Router",
    color: "#00C9B1", colorLt: "#E0FAF7", icon: "⟶",
    system: `You are an intelligent SEO workflow router for Kalpi. Decide which workflow to run.
Return ONLY valid JSON — no markdown, no explanation:
{"mode":"pipeline","topic":"cleaned keyword","reasoning":"one sentence why","confidence":"high"}
Rules: "pipeline" is DEFAULT for article topics/keywords. "cluster" ONLY if input has: plan, cluster, ecosystem, content strategy, pillar, series. "refresh" ONLY if input has: refresh, update, re-rank, our article, published post. When in doubt use "pipeline". Clean topic to concise SEO keyword.`,
  }
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseJSON(text) {
  if (!text) return null;
  // Try to extract a JSON object from the text
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fall through */ }
  }
  // Try raw parse
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  return null;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateHTML(articleMd, seoData, briefData, factcheckData, topic, visualsData) {
  const title = seoData?.title_tag || `${topic} | Kalpi`;
  const slug = seoData?.slug || topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const meta = briefData?.meta_description || seoData?.og_tags?.["og:description"] || "";
  const schema = seoData?.schema_json ? JSON.stringify(seoData.schema_json, null, 2) : "";
  const ogTitle = seoData?.og_tags?.["og:title"] || title;
  const ogDesc = seoData?.og_tags?.["og:description"] || meta;
  const disclaimers = factcheckData?.required_disclaimers || [];

  // Build a map of heading → images/charts to insert after
  const sectionImgMap = {};
  (visualsData?.section_images || []).forEach(img => {
    const key = (img.after_heading || "").toLowerCase().trim();
    if (key) sectionImgMap[key] = img;
  });
  const chartMap = {};
  (visualsData?.charts || []).forEach(ch => {
    const key = (ch.after_heading || "").toLowerCase().trim();
    if (!chartMap[key]) chartMap[key] = [];
    chartMap[key].push(ch);
  });

  // Build Unsplash image URL helper (no API key needed)// Build Pollinations image URL helper
  const unsplashImg = (query, w = 800) =>
    `https://image.pollinations.ai/prompt/${encodeURIComponent(query)}?width=${w}&height=${Math.round(w * 0.56)}&nologo=true`;
  // Hero image
  const heroQuery = visualsData?.hero_image?.query || topic.replace(/[^a-z0-9 ]/gi, "");
  const heroAlt = visualsData?.hero_image?.alt || topic;

  // Generate Chart.js canvas + script for each chart
  let chartScripts = "";
  let chartIdx = 0;
  function makeChartHTML(ch) {
    const id = `kalpi-chart-${chartIdx++}`;
    const ds = (ch.data?.datasets || []).map(d => {
      const color = d.color || "#00C9B1";
      const bgColors = ch.type === "pie" || ch.type === "doughnut"
        ? JSON.stringify((ch.data?.labels || []).map((_, i) => {
            const palette = ["#00C9B1","#8B5CF6","#F59E0B","#22C55E","#EF4444","#3B82F6","#EC4899","#F97316"];
            return palette[i % palette.length];
          }))
        : ch.type === "bar"
          ? JSON.stringify((d.data || []).map(() => color + "CC"))
          : `"${color}"`;
      const borderColor = ch.type === "pie" || ch.type === "doughnut"
        ? JSON.stringify((ch.data?.labels || []).map((_, i) => {
            const palette = ["#00C9B1","#8B5CF6","#F59E0B","#22C55E","#EF4444","#3B82F6","#EC4899","#F97316"];
            return palette[i % palette.length];
          }))
        : `"${color}"`;
      return `{
        label: "${(d.label || "").replace(/"/g, '\\"')}",
        data: ${JSON.stringify(d.data || [])},
        backgroundColor: ${bgColors},
        borderColor: ${borderColor},
        borderWidth: ${ch.type === "line" ? 2.5 : ch.type === "pie" || ch.type === "doughnut" ? 2 : 1},
        ${ch.type === "line" ? 'fill: false, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#fff", pointBorderWidth: 2,' : ""}
        ${ch.type === "bar" ? 'borderRadius: 6,' : ""}
      }`;
    }).join(",\n");

    chartScripts += `
new Chart(document.getElementById("${id}"), {
  type: "${ch.type || "bar"}",
  data: {
    labels: ${JSON.stringify(ch.data?.labels || [])},
    datasets: [${ds}]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: ${(ch.data?.datasets || []).length > 1 || ch.type === "pie" || ch.type === "doughnut"}, labels: { color: "#64748B", font: { family: "system-ui", size: 12 } } },
      title: { display: false }
    },
    ${ch.type !== "pie" && ch.type !== "doughnut" ? `scales: {
      x: { grid: { color: "#E2E8F020" }, ticks: { color: "#64748B", font: { size: 11 } } },
      y: { grid: { color: "#E2E8F0" }, ticks: { color: "#64748B", font: { size: 11 } } }
    }` : ""}
  }
});`;

    return `<figure class="chart-figure" role="img" aria-label="${(ch.alt || ch.title || "").replace(/"/g, "&quot;")}">
      <div class="chart-title">${ch.title || ""}</div>
      <div class="chart-container"><canvas id="${id}"></canvas></div>
      ${ch.caption ? `<figcaption class="chart-caption">${ch.caption}</figcaption>` : ""}
    </figure>`;
  }

  // Convert markdown to HTML, injecting images + charts after matched headings
  let body = (articleMd || "")
    .replace(/<!-- META: (.+?) -->/g, "")
    .replace(/<!-- IMAGE: (.+?) -->/g, "")
    .replace(/<!-- CTA: (.+?) -->/g, (_, cta) =>
      `<div class="cta-box"><p>${cta}</p><a href="https://kalpi.app" class="cta-btn">Start with Kalpi →</a></div>`)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, (match, heading) => {
      let extra = "";
      const hKey = heading.toLowerCase().trim();
      // Insert section image after this heading
      if (sectionImgMap[hKey]) {
        const img = sectionImgMap[hKey];
        extra += `<figure class="article-img"><img src="${unsplashImg(img.query)}" alt="${(img.alt || "").replace(/"/g, "&quot;")}" loading="lazy" /><figcaption>${img.alt || ""}</figcaption></figure>`;
      }
      // Insert charts after this heading
      if (chartMap[hKey]) {
        chartMap[hKey].forEach(ch => { extra += makeChartHTML(ch); });
      }
      return `<h2>${heading}</h2>${extra}`;
    })
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="ext-link">$1 ↗</a>')
    .replace(/\[(.+?)\]\((\/.+?)\)/g, '<a href="https://kalpi.app$2" class="int-link">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "\n</p>\n<p>\n")
    .replace(/^(?!<[hufld])/gm, "");

  body = `<p>${body}</p>`
    .replace(/<p>\s*<(h[1-3]|ul|ol|div|figure|li)/g, "<$1")
    .replace(/<\/(h[1-3]|ul|ol|div|figure)>\s*<\/p>/g, "</$1>")
    .replace(/<p>\s*<\/p>/g, "");

  // Also inject any charts whose heading didn't match — append at end of article
  const usedHeadings = new Set([...Object.keys(sectionImgMap), ...Object.keys(chartMap)]);
  let remainingCharts = "";
  (visualsData?.charts || []).forEach(ch => {
    const key = (ch.after_heading || "").toLowerCase().trim();
    if (!usedHeadings.has(key) || !key) {
      remainingCharts += makeChartHTML(ch);
    }
  });

  const faqSchemaItems = (briefData?.faq_questions || []).map(q => `{
      "@type": "Question",
      "name": "${q.replace(/"/g, '\\"')}",
      "acceptedAnswer": { "@type": "Answer", "text": "See article section above." }
    }`).join(",\n    ");

  // Collect all image URLs for og:image (use hero)
  const ogImage = unsplashImg(heroQuery, 1200);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${meta}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://kalpi.app/blog/${slug}">

  <!-- Open Graph -->
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDesc}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://kalpi.app/blog/${slug}">
  <meta property="og:site_name" content="Kalpi">
  <meta property="og:image" content="${ogImage}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDesc}">
  <meta name="twitter:image" content="${ogImage}">

  ${schema ? `<!-- Article Schema -->
  <script type="application/ld+json">
${schema}
  </script>` : ""}

  ${faqSchemaItems ? `<!-- FAQ Schema -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
    ${faqSchemaItems}
    ]
  }
  </script>` : ""}

  <!-- Chart.js for data visualisations -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>

  <style>
    :root {
      --navy: #0D1B2A; --teal: #00C9B1; --teal-light: #E0FAF7;
      --text: #1E293B; --text-muted: #64748B; --bg: #FFFFFF;
      --surface: #F8FAFC; --border: #E2E8F0; --max-w: 720px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      color: var(--text); background: var(--bg); line-height: 1.8;
      -webkit-font-smoothing: antialiased;
    }
    .hero-wrap {
      position: relative; width: 100%; max-height: 420px; overflow: hidden;
    }
    .hero-wrap img {
      width: 100%; height: 420px; object-fit: cover; display: block;
    }
    .hero-overlay {
      position: absolute; inset: 0;
      background: linear-gradient(to bottom, rgba(13,27,42,0.3) 0%, rgba(13,27,42,0.92) 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      padding: 48px 24px;
    }
    .hero-overlay .logo { font-size: 13px; letter-spacing: 0.15em; color: var(--teal);
      text-transform: uppercase; font-family: monospace; margin-bottom: 16px; }
    .hero-overlay h1 { font-size: 34px; max-width: var(--max-w); margin: 0 auto;
      line-height: 1.3; font-weight: 400; color: #fff; text-align: center; }
    .hero-overlay .meta-line { margin-top: 16px; font-size: 14px; color: #94A3B8;
      font-family: system-ui, sans-serif; }
    article { max-width: var(--max-w); margin: 0 auto; padding: 40px 24px 80px; }
    article h2 { font-size: 24px; color: var(--navy); margin: 36px 0 16px;
      padding-bottom: 8px; border-bottom: 2px solid var(--teal); font-weight: 400; }
    article h3 { font-size: 18px; color: var(--navy); margin: 24px 0 12px; }
    article p { margin-bottom: 16px; font-size: 17px; }
    article a { color: var(--teal); text-decoration: underline; text-underline-offset: 3px; }
    article a:hover { color: #009E8C; }
    article a.ext-link { color: var(--teal); border-bottom: 1px dashed var(--teal); text-decoration: none; }
    article a.ext-link:hover { color: #009E8C; border-bottom-color: #009E8C; }
    article a.int-link { color: #0D1B2A; background: #E0FAF7; padding: 1px 5px; border-radius: 3px; text-decoration: none; font-weight: 500; }
    article a.int-link:hover { background: #B2F5EA; }
    article ul, article ol { margin: 12px 0 16px 24px; }
    article li { margin-bottom: 6px; font-size: 17px; }
    article strong { color: var(--navy); }
    .article-img { margin: 28px 0; border-radius: 12px; overflow: hidden; }
    .article-img img { width: 100%; height: auto; display: block; border-radius: 12px; }
    .article-img figcaption { font-size: 13px; color: var(--text-muted); margin-top: 8px;
      font-family: system-ui, sans-serif; font-style: italic; text-align: center; }
    .chart-figure { margin: 32px 0; }
    .chart-title { font-family: system-ui, sans-serif; font-size: 16px; font-weight: 600;
      color: var(--navy); margin-bottom: 12px; text-align: center; }
    .chart-container { background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 20px; max-width: 600px; margin: 0 auto; }
    .chart-caption { font-size: 12px; color: var(--text-muted); margin-top: 10px;
      font-family: system-ui, sans-serif; text-align: center; font-style: italic; }
    .img-placeholder { margin: 24px 0; text-align: center; }
    .img-box { background: var(--surface); border: 2px dashed var(--border);
      border-radius: 12px; padding: 40px 24px; font-size: 15px; color: var(--text-muted);
      font-family: system-ui, sans-serif; }
    .cta-box { background: var(--teal-light); border: 1px solid #B2F5EA;
      border-radius: 12px; padding: 28px; margin: 32px 0; text-align: center; }
    .cta-box p { font-size: 16px; color: var(--navy); margin-bottom: 16px; }
    .cta-btn { display: inline-block; background: var(--teal); color: var(--navy);
      font-weight: 700; padding: 12px 28px; border-radius: 8px; text-decoration: none;
      font-family: system-ui, sans-serif; font-size: 15px; }
    .cta-btn:hover { background: #009E8C; color: #fff; }
    .disclaimer { max-width: var(--max-w); margin: 0 auto; padding: 0 24px 40px;
      font-size: 13px; color: var(--text-muted); border-top: 1px solid var(--border);
      padding-top: 20px; font-family: system-ui, sans-serif; line-height: 1.6; }
    .seo-score { position: fixed; bottom: 16px; right: 16px; background: var(--navy);
      color: var(--teal); padding: 8px 14px; border-radius: 8px; font-family: monospace;
      font-size: 12px; z-index: 100; opacity: 0.9; }
    @media (max-width: 600px) {
      .hero-overlay h1 { font-size: 24px; }
      .hero-wrap img { height: 280px; }
      article { padding: 24px 16px 60px; }
      .chart-container { padding: 12px; }
    }
  </style>
</head>
<body>

  <!-- Hero with real image -->
  <div class="hero-wrap">
    <img src="${unsplashImg(heroQuery, 1400)}" alt="${heroAlt.replace(/"/g, "&quot;")}" />
    <div class="hero-overlay">
      <div class="logo">◈ Kalpi Blog</div>
      <h1>${title.replace(" | Kalpi", "")}</h1>
      <div class="meta-line">Published on Kalpi · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>
  </div>

  <article>
    ${body}
    ${remainingCharts}
    ${(briefData?.internal_links?.length > 0) ? `<div style="background:#E0FAF7;border:1px solid #B2F5EA;border-radius:12px;padding:20px 24px;margin:32px 0;">
      <div style="font-size:11px;font-weight:700;color:#009E8C;letter-spacing:.1em;text-transform:uppercase;font-family:system-ui,sans-serif;margin-bottom:12px;">◈ Also on Kalpi Blog</div>
      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">
        ${(briefData?.internal_links || []).map(l => `<li><a href="https://kalpi.app${l.url}" style="color:#0D1B2A;font-weight:500;font-size:15px;text-decoration:none;font-family:Georgia,serif;">${l.anchor} →</a></li>`).join('')}
      </ul>
    </div>` : ''}
  </article>

  <!-- Sources & References -->
  ${(briefData?.external_links?.length > 0) ? `<div style="max-width:var(--max-w);margin:0 auto;padding:0 24px 32px;">
    <h3 style="font-size:16px;color:var(--navy);margin-bottom:12px;font-family:system-ui,sans-serif;font-weight:600;">Sources &amp; References</h3>
    <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;">
      ${(briefData?.external_links || []).map(l => `<li style="font-size:13px;font-family:system-ui,sans-serif;"><a href="${l.url}" target="_blank" rel="noopener noreferrer" style="color:var(--teal);text-decoration:none;">${l.anchor || l.authority} ↗</a>${l.authority ? ` <span style="color:#64748B;font-size:12px;">— ${l.authority}</span>` : ''}</li>`).join('')}
    </ul>
  </div>` : ''}

  ${disclaimers.length > 0 ? `<div class="disclaimer">
    <strong>Disclaimer:</strong> ${disclaimers.join(" ")}
    <br>Mutual fund investments are subject to market risks. Read all scheme-related documents carefully before investing.
  </div>` : `<div class="disclaimer">
    <strong>Disclaimer:</strong> This article is for educational purposes only and does not constitute financial advice.
    Mutual fund investments are subject to market risks. Read all scheme-related documents carefully before investing.
  </div>`}

  <div class="seo-score">SEO: ${seoData?.total_score || "—"}/100</div>

  <!-- Render charts -->
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      ${chartScripts}
    });
  </script>
</body>
</html>`;
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const bg = { idle: T.muted, running: T.teal, done: T.green, error: T.red }[status] || T.muted;
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: bg, flexShrink: 0,
      animation: status === "running" ? "kpulse 1.2s ease-in-out infinite" : "none",
    }} />
  );
}

function ScoreBar({ value, color }) {
  const c = value >= 75 ? T.green : value >= 55 ? T.amber : T.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: T.navyLt, borderRadius: 3 }}>
        <div style={{
          width: `${Math.min(value, 100)}%`, height: "100%", borderRadius: 3,
          background: color || c, transition: "width 1s ease"
        }} />
      </div>
      <span style={{
        fontSize: 14, fontWeight: 700, color: T.white,
        fontFamily: "'DM Mono',monospace", minWidth: 28
      }}>{value}</span>
    </div>
  );
}

function JsonCard({ data, agentId }) {
  const a = AGENTS[agentId] || { color: T.teal };
  if (!data || typeof data !== "object") return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Object.entries(data).map(([k, v]) => {
        if (v === null || v === undefined) return null;
        const isArr = Array.isArray(v);
        const isObj = typeof v === "object" && !isArr;
        const isScore = typeof v === "number" && k.toLowerCase().includes("score");
        return (
          <div key={k} style={{
            background: T.navyLt, borderRadius: 8,
            border: `1px solid ${a.color}20`, overflow: "hidden"
          }}>
            <div style={{
              padding: "5px 10px", background: `${a.color}12`,
              borderBottom: `1px solid ${a.color}20`, fontSize: 9, fontWeight: 700,
              color: a.color, fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em",
              textTransform: "uppercase"
            }}>{k.replace(/_/g, " ")}</div>
            <div style={{ padding: "8px 10px" }}>
              {isScore && <ScoreBar value={v} />}
              {isArr && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {v.map((item, i) => (
                    <div key={i} style={{
                      fontSize: 11.5, color: T.silver, lineHeight: 1.5,
                      display: "flex", gap: 6
                    }}>
                      <span style={{
                        color: a.color, fontFamily: "'DM Mono',monospace",
                        fontSize: 10, flexShrink: 0, paddingTop: 1
                      }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ wordBreak: "break-word" }}>
                        {typeof item === "object" ? JSON.stringify(item, null, 1) : String(item)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {isObj && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {Object.entries(v).map(([sk, sv]) => (
                    <span key={sk} style={{
                      fontSize: 10.5, padding: "3px 8px",
                      background: T.navy, borderRadius: 5, color: T.silver
                    }}>
                      <span style={{ color: a.color }}>{sk}</span>
                      <span style={{ color: T.muted }}> · </span>
                      <span style={{ color: T.white, fontWeight: 600 }}>{String(sv)}</span>
                    </span>
                  ))}
                </div>
              )}
              {!isArr && !isObj && !isScore && (
                <span style={{
                  fontSize: 12.5, color: T.white, lineHeight: 1.5,
                  fontFamily: k === "verdict" || k === "trajectory" || k === "slug"
                    ? "'DM Mono',monospace" : "Georgia,serif",
                  fontWeight: typeof v === "string" && v.length < 25 ? 600 : 400,
                  wordBreak: "break-word"
                }}>
                  {String(v)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArticlePreview({ text }) {
  const lines = (text || "").split("\n");
  return (
    <div style={{ fontFamily: "Georgia,serif", fontSize: 12, lineHeight: 1.8, color: T.silver }}>
      {lines.slice(0, 80).map((line, i) => {
        if (line.startsWith("# ")) return <div key={i} style={{ fontSize: 15, fontWeight: 700, color: T.white, margin: "10px 0 3px" }}>{line.slice(2)}</div>;
        if (line.startsWith("## ")) return <div key={i} style={{ fontSize: 12, fontWeight: 700, color: T.teal, margin: "9px 0 2px", fontFamily: "'DM Mono',monospace" }}>{line.slice(3)}</div>;
        if (line.startsWith("### ")) return <div key={i} style={{ fontSize: 11, fontWeight: 700, color: T.silver, margin: "7px 0 2px" }}>{line.slice(4)}</div>;
        if (line.startsWith("<!-- ")) return <div key={i} style={{ fontSize: 9.5, color: T.amber, fontFamily: "'DM Mono',monospace", padding: "2px 7px", background: `${T.amber}12`, borderRadius: 4, margin: "3px 0" }}>{line}</div>;
        if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 14, borderLeft: `2px solid ${T.teal}40`, marginBottom: 2, fontSize: 11.5 }}>{"· " + line.slice(2)}</div>;
        if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
        return <div key={i}>{line}</div>;
      })}
      {lines.length > 80 && (
        <div style={{ marginTop: 8, fontSize: 10, color: T.muted, fontFamily: "'DM Mono',monospace" }}>
          +{lines.length - 80} more lines…
        </div>
      )}
    </div>
  );
}

function AgentPanel({ agentId, status, output, streamText, isActive }) {
  const a = AGENTS[agentId];
  const [open, setOpen] = useState(false);

  useEffect(() => { if (isActive) setOpen(true); }, [isActive]);

  if (!a) return null;

  const bdr = isActive ? `1px solid ${a.color}70`
    : status === "done" ? `1px solid ${a.color}30`
    : `1px solid ${T.border}`;

  return (
    <div style={{
      borderRadius: 10, border: bdr, overflow: "hidden",
      background: T.navyMid, transition: "all .25s"
    }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 13px",
        cursor: "pointer", background: isActive ? `${a.color}10` : "transparent"
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7,
          background: status === "idle" ? T.navyLt : `${a.color}20`,
          border: `1px solid ${status === "idle" ? T.border : a.color + "50"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: status === "idle" ? T.muted : a.color,
          flexShrink: 0, transition: "all .25s"
        }}>{a.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700,
            color: status === "idle" ? T.muted : T.white,
            fontFamily: "'DM Mono',monospace"
          }}>{a.label}</div>
          {status === "done" && output && (
            <div style={{ fontSize: 9.5, color: T.muted, marginTop: 1 }}>
              {typeof output === "object" && output?.verdict && `verdict: ${output.verdict}`}
              {typeof output === "object" && output?.total_score !== undefined && `score: ${output.total_score}/100`}
              {typeof output === "object" && output?.health_score !== undefined && `health: ${output.health_score}/100`}
              {typeof output === "object" && output?.total_articles !== undefined && `${output.total_articles} articles planned`}
              {typeof output === "string" && `${output.split(/\s+/).filter(Boolean).length} words`}
            </div>
          )}
        </div>
        <StatusDot status={status} />
        <span style={{ color: T.muted, fontSize: 9, marginLeft: 2 }}>{open ? "▾" : "▸"}</span>
      </div>

      {open && (status === "running" || status === "done") && (
        <div style={{ padding: "0 13px 13px", maxHeight: 360, overflowY: "auto" }}>
          <div style={{ height: 1, background: `${a.color}20`, marginBottom: 10 }} />
          {status === "running" && (
            <div style={{
              fontSize: 9.5, color: a.color, fontFamily: "'DM Mono',monospace",
              animation: "kblink 1s step-end infinite", marginBottom: 8
            }}>● RUNNING</div>
          )}
          {status === "running" && streamText && (
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 11, lineHeight: 1.7,
              color: T.silver, whiteSpace: "pre-wrap", wordBreak: "break-word"
            }}>{streamText.slice(-2000)}</div>
          )}
          {status === "done" && output && (
            typeof output === "string"
              ? <ArticlePreview text={output} />
              : <JsonCard data={output} agentId={agentId} />
          )}
        </div>
      )}
    </div>
  );
}

function ClusterMap({ data }) {
  if (!data?.satellites) return null;
  const sats = data.satellites.slice(0, 10);
  const cx = 250, cy = 110, r = 85;
  const diffColor = { low: T.green, medium: T.amber, high: T.red };

  return (
    <div style={{
      background: T.navyMid, borderRadius: 10, border: `1px solid ${T.border}`,
      padding: 14, marginTop: 14
    }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, color: T.teal, letterSpacing: "0.08em",
        textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 10
      }}>
        cluster map — {data.pillar_keyword}
      </div>
      <svg width="100%" viewBox="0 0 520 230">
        {sats.map((s, i) => {
          const angle = (i / sats.length) * Math.PI * 2 - Math.PI / 2;
          const sx = cx + Math.cos(angle) * r, sy = cy + Math.sin(angle) * r;
          return <line key={`l${i}`} x1={cx} y1={cy} x2={sx} y2={sy}
            stroke={`${T.teal}28`} strokeWidth="1" strokeDasharray="3 3" />;
        })}
        {sats.map((s, i) => {
          const angle = (i / sats.length) * Math.PI * 2 - Math.PI / 2;
          const sx = cx + Math.cos(angle) * r, sy = cy + Math.sin(angle) * r;
          const col = diffColor[s.difficulty] || T.teal;
          const words = (s.keyword || "").split(" ");
          return (
            <g key={`n${i}`}>
              <circle cx={sx} cy={sy} r={17} fill={T.navy} stroke={col} strokeWidth="1.5" />
              <text x={sx} y={sy - 3} textAnchor="middle" fill={T.silver}
                fontSize="6.5" fontFamily="monospace">{words.slice(0, 2).join(" ")}</text>
              <text x={sx} y={sy + 7} textAnchor="middle" fill={T.muted}
                fontSize="5.5" fontFamily="monospace">{words.slice(2, 4).join(" ")}</text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={30} fill={`${T.teal}14`} stroke={T.teal} strokeWidth="2" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={T.teal}
          fontSize="7.5" fontWeight="700" fontFamily="monospace">PILLAR</text>
        <text x={cx} y={cy + 7} textAnchor="middle" fill={T.white}
          fontSize="6.5" fontFamily="serif">{(data.pillar_keyword || "").split(" ").slice(0, 3).join(" ")}</text>
        {[["low", T.green, "Low diff"], ["medium", T.amber, "Medium"], ["high", T.red, "High"]].map(([k, c, l], i) => (
          <g key={k} transform={`translate(370,${78 + i * 20})`}>
            <circle r={4.5} fill={T.navy} stroke={c} strokeWidth="1.5" />
            <text x={11} y={4} fill={T.muted} fontSize="9" fontFamily="monospace">{l}</text>
          </g>
        ))}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
        {sats.map((s, i) => (
          <span key={i} style={{
            fontSize: 9.5, padding: "2px 7px", borderRadius: 20,
            background: T.navy, border: `1px solid ${(diffColor[s.difficulty] || T.teal)}40`,
            color: T.silver, fontFamily: "'DM Mono',monospace"
          }}>
            <span style={{ color: diffColor[s.difficulty] || T.teal }}>●</span> {s.keyword}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
const EXAMPLES = [
  "What is SIP investing?", "Mutual funds for beginners",
  "ELSS tax saving funds", "Index funds vs active funds",
  "How to start investing at 25", "What is NAV in mutual funds?",
];

export default function App() {
  const [topic, setTopic] = useState("");
  const [detectedMode, setDetectedMode] = useState(null);
  const [routerReason, setRouterReason] = useState("");
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(null);
  const [stages, setStages] = useState({});
  const [streams, setStreams] = useState({});
  const [clusterData, setClusterData] = useState(null);
  const [log, setLog] = useState([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log]);

  const addLog = useCallback((msg, type = "info") =>
    setLog(l => [...l, { msg, type, t: new Date().toLocaleTimeString("en-IN", { hour12: false }) }])
  , []);

  const setStageStatus = useCallback((id, status, output = null) =>
    setStages(s => ({ ...s, [id]: { status, output } }))
  , []);

  const setStream = useCallback((id, text) =>
    setStreams(s => ({ ...s, [id]: text }))
  , []);

  const reset = useCallback(() => {
    setDone(false);
    setError(null);
    setStages({});
    setStreams({});
    setClusterData(null);
    setLog([]);
    setActiveStage(null);
  }, []);

  // ─── Run a single agent stage ─────────────────────────────────────────────
  const runAgent = useCallback(async (agentId, userContent) => {
    const agent = AGENTS[agentId];
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    setActiveStage(agentId);
    setStageStatus(agentId, "running");

    let raw = "";
    raw = await callClaude(
      [{ role: "user", content: userContent }],
      agent.system,
      (text) => { raw = text; setStream(agentId, text); }
    );

    // For the writer agent, output is raw markdown text
    // For all other agents, parse as JSON
    if (agentId === "writer") {
      setStageStatus(agentId, "done", raw);
      return raw;
    }

    const parsed = parseJSON(raw);
    if (!parsed) {
      // If JSON parse fails, store raw text and warn
      setStageStatus(agentId, "done", { _raw: raw, _parse_error: "Could not parse JSON from agent response" });
      return null;
    }
    setStageStatus(agentId, "done", parsed);
    return parsed;
  }, [setStageStatus, setStream]);

  // ─── PIPELINE ─────────────────────────────────────────────────────────────
  const runPipeline = useCallback(async () => {
    if (!topic.trim() || running) return;
    setRunning(true);
    reset();
    addLog(`▶ Starting pipeline for: "${topic}"`, "start");

    let serpData = null, briefData = null, articleText = null, fcData = null, seoData = null, visualsData = null;

    // 1. SERP Analysis
    try {
      addLog("SERP agent scanning competitors…", "agent");
      serpData = await runAgent("serp",
        `Analyse SERP for: "${topic}" in the Indian investing market. Return JSON only.`
      );
      addLog(`✓ SERP done — ${serpData?.content_gaps?.length || 0} gaps found`, "done");
    } catch (e) {
      setStageStatus("serp", "error");
      addLog("✗ SERP: " + e.message, "error");
      setError(e.message);
      setRunning(false);
      return;
    }

    // 2. Content Brief
    try {
      addLog("Brief agent crafting strategy…", "agent");
      briefData = await runAgent("brief",
        `Create a content brief for: "${topic}".
Content gaps from SERP analysis: ${JSON.stringify(serpData?.content_gaps?.slice(0, 5) || [])}.
Semantic keywords: ${JSON.stringify(serpData?.semantic_keywords?.slice(0, 8) || [])}.
Competitor FAQs: ${JSON.stringify(serpData?.competitor_faqs?.slice(0, 5) || [])}.
Average competitor word count: ${serpData?.avg_word_count || 1600}.
Return JSON only.`
      );
      addLog(`✓ Brief done — angle: "${(briefData?.kalpi_angle || "").slice(0, 55)}…"`, "done");
    } catch (e) {
      setStageStatus("brief", "error");
      addLog("✗ Brief: " + e.message, "error");
      // Continue with defaults
      briefData = { target_keyword: topic, required_h2s: [], faq_questions: [], target_word_count: 1600 };
    }

    // 3. Write Article
    try {
      addLog("Writer agent drafting article…", "agent");
      articleText = await runAgent("writer",
        `Write a full article for: "${topic}".
Required H2 sections: ${JSON.stringify(briefData?.required_h2s || [])}.
Unique angle: ${briefData?.kalpi_angle || "Beginner-friendly guide for young Indian investors"}.
Target word count: ${briefData?.target_word_count || 1600} words.
FAQ questions to answer: ${JSON.stringify(briefData?.faq_questions?.slice(0, 5) || [])}.
Meta description: "${briefData?.meta_description || ""}".
Internal links to include: ${JSON.stringify(briefData?.internal_links || [])}.
External authority links: ${JSON.stringify(briefData?.external_links || [])}.
CTA: ${briefData?.cta || "Start investing with Kalpi"}.
Image suggestions: ${JSON.stringify(briefData?.image_suggestions || [])}.
Write the complete article now.`
      );
      const wordCount = (articleText || "").split(/\s+/).filter(Boolean).length;
      addLog(`✓ Article written — ${wordCount} words`, "done");
    } catch (e) {
      setStageStatus("writer", "error");
      addLog("✗ Writer: " + e.message, "error");
    }

    // 4. Fact Check
    try {
      addLog("Fact checker validating claims…", "agent");
      fcData = await runAgent("factcheck",
        `Fact-check this Indian investing article:\n\n${(articleText || "").slice(0, 6000)}\n\nReturn JSON only.`
      );
      addLog(`✓ Fact check: ${(fcData?.verdict || "done").toUpperCase()} — ${(fcData?.summary || "").slice(0, 60)}`, "done");
    } catch (e) {
      setStageStatus("factcheck", "error");
      addLog("✗ Fact-check: " + e.message, "error");
    }

    // 5. SEO Score
    try {
      addLog("SEO scorer analysing optimisation…", "agent");
      seoData = await runAgent("seo",
        `Score this article for SEO on target keyword "${topic}".
Semantic variants: ${JSON.stringify(briefData?.semantic_variants?.slice(0, 5) || [])}.
Article content (first 5000 chars):\n\n${(articleText || "").slice(0, 5000)}\n\nReturn JSON only.`
      );
      addLog(`✓ SEO score: ${seoData?.total_score || "—"}/100 — ${(seoData?.verdict || "").slice(0, 50)}`, "done");
    } catch (e) {
      setStageStatus("seo", "error");
      addLog("✗ SEO: " + e.message, "error");
    }

    // 6. Visual Engine — generate chart specs + image search queries
    try {
      addLog("Visual engine generating images + charts…", "agent");
      visualsData = await runAgent("visuals",
        `Analyse this investing article and generate image + chart specifications.
Topic: "${topic}"
Article H2 headings: ${JSON.stringify(
          (articleText || "").split("\n")
            .filter(l => l.startsWith("## "))
            .map(l => l.slice(3).trim())
        )}
Article content (first 4000 chars):
${(articleText || "").slice(0, 4000)}

Return JSON with hero_image, section_images (2-3), and charts (2-3) with realistic Indian investing data.`
      );
      const nCharts = visualsData?.charts?.length || 0;
      const nImgs = (visualsData?.section_images?.length || 0) + (visualsData?.hero_image ? 1 : 0);
      addLog(`✓ Visuals done — ${nCharts} charts, ${nImgs} images generated`, "done");
    } catch (e) {
      setStageStatus("visuals", "error");
      addLog("✗ Visuals: " + e.message, "error");
    }

    setActiveStage(null);
    setRunning(false);
    setDone(true);
    addLog("✓ Pipeline complete — article ready for review", "done");
  }, [topic, running, reset, addLog, runAgent, setStageStatus]);

  // ─── CLUSTER ──────────────────────────────────────────────────────────────
  const runCluster = useCallback(async () => {
    if (!topic.trim() || running) return;
    setRunning(true);
    reset();
    addLog(`▶ Planning cluster for: "${topic}"`, "start");

    let serpData = null;

    try {
      addLog("SERP agent scanning competitors…", "agent");
      serpData = await runAgent("serp",
        `Analyse SERP for: "${topic}" in the Indian investing market. Return JSON only.`
      );
      addLog("✓ SERP done", "done");
    } catch (e) {
      setStageStatus("serp", "error");
      addLog("✗ SERP: " + e.message, "error");
    }

    try {
      addLog("Cluster planner mapping ecosystem…", "agent");
      const cd = await runAgent("cluster",
        `Plan a 10-satellite topic cluster for pillar topic: "${topic}".
Gaps from SERP: ${JSON.stringify(serpData?.content_gaps?.slice(0, 5) || [])}.
Semantic keywords: ${JSON.stringify(serpData?.semantic_keywords?.slice(0, 8) || [])}.
Return JSON only.`
      );
      setClusterData(cd);
      addLog(`✓ Cluster mapped — ${cd?.total_articles || 11} articles planned`, "done");
    } catch (e) {
      setStageStatus("cluster", "error");
      addLog("✗ Cluster: " + e.message, "error");
    }

    setActiveStage(null);
    setRunning(false);
    setDone(true);
    addLog("✓ Cluster plan complete", "done");
  }, [topic, running, reset, addLog, runAgent, setStageStatus]);

  // ─── REFRESH ──────────────────────────────────────────────────────────────
  const runRefresh = useCallback(async () => {
    if (!topic.trim() || running) return;
    setRunning(true);
    reset();
    addLog(`▶ Refresh assessment for: "${topic}"`, "start");

    try {
      addLog("Refresh monitor re-scanning SERPs…", "agent");
      await runAgent("refresh",
        `Assess ranking health of a Kalpi article about "${topic}".
Published 45 days ago, approximately 1,400 words, initial SEO score 78/100.
Simulate a SERP re-scan and competitor movement analysis. Return JSON only.`
      );
      const rd = stages.refresh?.output;
      addLog(`✓ Refresh assessment complete`, "done");
    } catch (e) {
      setStageStatus("refresh", "error");
      addLog("✗ Refresh: " + e.message, "error");
      setError(e.message);
    }

    setActiveStage(null);
    setRunning(false);
    setDone(true);
    addLog("✓ Refresh assessment complete", "done");
  }, [topic, running, reset, addLog, runAgent, setStageStatus]);

  const handleRun = useCallback(async () => {
    if (!topic.trim() || running) return;
    setRunning(true);
    reset();
    addLog(`▶ Analysing: "${topic}"`, "start");
    // Route: ask Claude what to do
    let routeResult = { mode: "pipeline", topic: topic, reasoning: "Default pipeline" };
    try {
      setActiveStage("router");
      setStageStatus("router", "running");
      let raw = "";
      raw = await callClaude(
        [{ role: "user", content: `Decide workflow for: "${topic}". Return JSON only.` }],
        AGENTS.router.system,
        (t) => { raw = t; setStream("router", t); }
      );
      const parsed = parseJSON(raw);
      if (parsed?.mode) routeResult = { ...parsed, topic: parsed.topic || topic };
      setStageStatus("router", "done", routeResult);
      setDetectedMode(routeResult.mode);
      setRouterReason(routeResult.reasoning || "");
      addLog(`⟶ ${routeResult.mode.toUpperCase()}: ${routeResult.reasoning}`, "done");
    } catch (e) {
      setStageStatus("router", "error");
      setDetectedMode("pipeline");
      addLog("Router failed, defaulting to pipeline", "error");
    }
    setRunning(false);
    const t2 = routeResult.topic || topic;
    if (routeResult.mode === "cluster") runClusterDirect(t2);
    else if (routeResult.mode === "refresh") runRefreshDirect(t2);
    else runPipelineDirect(t2);
  }, [topic, running, reset, addLog, setStageStatus, setStream]);

  const runPipelineDirect = useCallback(async (t) => {
    setRunning(true);
    addLog(`▶ Pipeline: "${t}"`, "start");
    let serpData=null, briefData=null, articleText=null, fcData=null, seoData=null, visualsData=null;
    try {
      addLog("SERP scanning…","agent");
      serpData = await runAgent("serp",`Analyse SERP for: "${t}" Indian investing. Return JSON only.`);
      addLog(`✓ SERP — ${serpData?.content_gaps?.length||0} gaps`,"done");
    } catch(e){ setStageStatus("serp","error"); setError(e.message); setRunning(false); return; }
    try {
      addLog("Brief drafting…","agent");
      briefData = await runAgent("brief",`Brief for: "${t}". Gaps: ${JSON.stringify(serpData?.content_gaps?.slice(0,5)||[])}. Semantic: ${JSON.stringify(serpData?.semantic_keywords?.slice(0,8)||[])}. FAQs: ${JSON.stringify(serpData?.competitor_faqs?.slice(0,5)||[])}. Avg words: ${serpData?.avg_word_count||1600}. Return JSON only.`);
      addLog(`✓ Brief — "${(briefData?.kalpi_angle||"").slice(0,50)}…"`,"done");
    } catch(e){ setStageStatus("brief","error"); briefData={target_keyword:t,required_h2s:[],faq_questions:[],target_word_count:1600}; }
    try {
      addLog("Writing article…","agent");
      articleText = await runAgent("writer",`Write full article for: "${t}". H2s: ${JSON.stringify(briefData?.required_h2s||[])}. Angle: ${briefData?.kalpi_angle||"Beginner guide for young Indian investors"}. Target: ${briefData?.target_word_count||1600} words. FAQs: ${JSON.stringify(briefData?.faq_questions?.slice(0,5)||[])}. Meta: "${briefData?.meta_description||""}". Internal: ${JSON.stringify(briefData?.internal_links||[])}. External: ${JSON.stringify(briefData?.external_links||[])}. CTA: ${briefData?.cta||"Start with Kalpi"}. Images: ${JSON.stringify(briefData?.image_suggestions||[])}.`);
      addLog(`✓ Article — ${(articleText||"").split(/\s+/).filter(Boolean).length} words`,"done");
    } catch(e){ setStageStatus("writer","error"); addLog("✗ Writer: "+e.message,"error"); }
    try {
      addLog("Fact checking…","agent");
      fcData = await runAgent("factcheck",`Fact-check this Indian investing article:

${(articleText||"").slice(0,6000)}

Return JSON only.`);
      addLog(`✓ Facts: ${(fcData?.verdict||"done").toUpperCase()}`,"done");
    } catch(e){ setStageStatus("factcheck","error"); }
    try {
      addLog("SEO scoring…","agent");
      seoData = await runAgent("seo",`Score for "${t}". Semantic: ${JSON.stringify(briefData?.semantic_variants?.slice(0,5)||[])}. Article:

${(articleText||"").slice(0,5000)}

Return JSON only.`);
      addLog(`✓ SEO: ${seoData?.total_score||"—"}/100`,"done");
    } catch(e){ setStageStatus("seo","error"); }
    try {
      addLog("Generating visuals…","agent");
      const h2s=(articleText||"").split("\n").filter(l=>l.startsWith("## ")).map(l=>l.slice(3).trim());
      visualsData = await runAgent("visuals",`Generate image+chart specs for "${t}". H2s: ${JSON.stringify(h2s)}. Article: ${(articleText||"").slice(0,4000)} Return JSON only.`);
      addLog(`✓ Visuals — ${visualsData?.charts?.length||0} charts`,"done");
    } catch(e){ setStageStatus("visuals","error"); }
    setActiveStage(null); setRunning(false); setDone(true);
    addLog("✓ Pipeline complete","done");
  }, [runAgent, setStageStatus, setError, addLog]);

  const runClusterDirect = useCallback(async (t) => {
    setRunning(true);
    addLog(`▶ Cluster: "${t}"`,"start");
    let serpData=null;
    try {
      addLog("SERP scanning…","agent");
      serpData = await runAgent("serp",`Analyse SERP for: "${t}" Indian investing. Return JSON only.`);
      addLog("✓ SERP done","done");
    } catch(e){ setStageStatus("serp","error"); }
    try {
      addLog("Planning cluster…","agent");
      const cd = await runAgent("cluster",`Plan 10-satellite cluster for: "${t}". Gaps: ${JSON.stringify(serpData?.content_gaps?.slice(0,4)||[])}. Return JSON only.`);
      setClusterData(cd);
      addLog(`✓ Cluster — ${cd?.total_articles||11} articles`,"done");
    } catch(e){ setStageStatus("cluster","error"); addLog("✗ "+e.message,"error"); }
    setActiveStage(null); setRunning(false); setDone(true);
    addLog("✓ Cluster complete","done");
  }, [runAgent, setStageStatus, addLog]);

  const runRefreshDirect = useCallback(async (t) => {
    setRunning(true);
    addLog(`▶ Refresh: "${t}"`,"start");
    try {
      addLog("Re-scanning SERPs…","agent");
      await runAgent("refresh",`Assess ranking health of Kalpi article about "${t}". Published 45 days ago, ~1400 words, score 78/100. Return JSON only.`);
      addLog("✓ Refresh done","done");
    } catch(e){ setStageStatus("refresh","error"); setError(e.message); }
    setActiveStage(null); setRunning(false); setDone(true);
    addLog("✓ Assessment done","done");
  }, [runAgent, setStageStatus, setError, addLog]);

  const handleExportHTML = () => {
    const articleText = stages.writer?.output;
    const seoData = stages.seo?.output;
    const briefData = stages.brief?.output;
    const fcData = stages.factcheck?.output;
    const visData = stages.visuals?.output;

    if (!articleText) {
      alert("No article to export. Run the pipeline first.");
      return;
    }

    const html = generateHTML(articleText, seoData, briefData, fcData, topic, visData);
    const slug = seoData?.slug || topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadFile(html, `${slug}.html`, "text/html");
  };

  // Agents shown in the left panel based on current mode
  const pipelineAgents =
    detectedMode === "cluster" ? ["router","serp","cluster"] :
    detectedMode === "refresh" ? ["router","refresh"] :
    ["router","serp","brief","writer","factcheck","seo","visuals"];

  const logColors = { info: T.muted, start: T.teal, agent: T.purple, done: T.green, error: T.red };

  const seoOut = stages.seo?.output;
  const fcOut = stages.factcheck?.output;
  const wOut = stages.writer?.output;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body,#root{min-height:100vh;background:#0D1B2A}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0D1B2A}
        ::-webkit-scrollbar-thumb{background:#00C9B140;border-radius:2px}
        @keyframes kpulse{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes kblink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes kfadeup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .run-btn:hover:not(:disabled){background:#009E8C!important;transform:translateY(-1px)}
        .run-btn:active:not(:disabled){transform:scale(.98)}
        .export-btn:hover{background:#22C55E!important;color:#0D1B2A!important}
        .mode-tab:hover{border-color:#00C9B150!important}
        .chip:hover{background:#00C9B118!important;border-color:#00C9B155!important;color:#FFFFFF!important;cursor:pointer}
        textarea:focus{outline:none!important;border-color:#00C9B180!important;box-shadow:0 0 0 3px #00C9B112}
      `}</style>

      <div style={{
        minHeight: "100vh", background: T.navy, fontFamily: "'DM Mono',monospace",
        color: T.white, padding: "20px 14px 32px"
      }}>

        {/* Header */}
        <div style={{ maxWidth: 960, margin: "0 auto 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: T.teal, letterSpacing: "0.15em",
                textTransform: "uppercase", marginBottom: 5
              }}>◈ KALPI · SEO CONTENT ENGINE</div>
              <div style={{
                fontSize: 26, fontFamily: "Georgia,serif",
                fontWeight: 400, color: T.white, lineHeight: 1.2
              }}>The Content Engine</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
                8 agents · type anything → Claude routes → pipeline, cluster, or refresh
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {Object.values(AGENTS).map(a => (
                <span key={a.id} style={{
                  fontSize: 9.5, padding: "2px 8px", borderRadius: 20,
                  background: `${a.color}12`, border: `1px solid ${a.color}28`, color: a.color
                }}>
                  {a.icon} {a.short}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          maxWidth: 960, margin: "0 auto",
          display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 14
        }}>

          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Smart routing hint */}
            <div style={{
              padding:"10px 14px", borderRadius:9,
              background:T.navyMid, border:`1px solid ${detectedMode ? T.teal+"50" : T.border}`,
              display:"flex", alignItems:"center", gap:10,
              transition:"border-color .3s"
            }}>
              <span style={{fontSize:16, color:T.teal}}>⟶</span>
              <div>
                {detectedMode ? (
                  <>
                    <div style={{fontSize:11,fontWeight:700,color:T.teal}}>
                      Running: {detectedMode==="pipeline"?"Full pipeline":detectedMode==="cluster"?"Cluster planner":"Refresh monitor"}
                    </div>
                    <div style={{fontSize:10,color:T.muted,marginTop:1}}>{routerReason}</div>
                  </>
                ) : (
                  <>
                    <div style={{fontSize:11,fontWeight:700,color:T.silver}}>Claude decides what to run</div>
                    <div style={{fontSize:10,color:T.muted,marginTop:1}}>topic → pipeline · "plan X" → cluster · "refresh X" → refresh monitor</div>
                  </>
                )}
              </div>
            </div>

            {/* Input */}
            <div style={{
              background: T.navyMid, borderRadius: 10, border: `1px solid ${T.border}`, padding: 14
            }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: T.teal,
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 9
              }}>Target keyword / topic</div>
              <textarea value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !running) {
                    e.preventDefault();
                    handleRun();
                  }
                }}
                placeholder="Type anything — Claude decides: topic → article, 'plan X' → cluster, 'refresh X' → monitor"
                disabled={running} rows={2}
                style={{
                  width: "100%", background: T.navy, border: `1px solid ${T.border}`,
                  borderRadius: 7, padding: "9px 11px", color: T.white,
                  fontSize: 12.5, fontFamily: "Georgia,serif", resize: "none", lineHeight: 1.5
                }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                {EXAMPLES.map(ex => (
                  <span key={ex} className="chip"
                    onClick={() => { if (!running) setTopic(ex); }}
                    style={{
                      fontSize: 9.5, padding: "2px 9px", borderRadius: 20,
                      background: T.navy, border: `1px solid ${T.border}`,
                      color: T.muted, transition: "all .15s"
                    }}>{ex}</span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="run-btn" onClick={handleRun}
                  disabled={running || !topic.trim()}
                  style={{
                    flex: 1, padding: "11px 0",
                    background: running ? T.navyLt : T.teal,
                    border: "none", borderRadius: 7,
                    cursor: running || !topic.trim() ? "not-allowed" : "pointer",
                    color: running ? T.muted : T.navy,
                    fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.05em", transition: "all .2s",
                    opacity: !topic.trim() ? .5 : 1
                  }}>
                  {running
                    ? `◈ RUNNING — ${(activeStage || "…").toUpperCase()}…`
                    : "▶ ANALYSE & RUN"}
                </button>
                {done && detectedMode === "pipeline" && wOut && (
                  <button className="export-btn" onClick={handleExportHTML}
                    style={{
                      padding: "11px 16px", background: `${T.green}20`,
                      border: `1px solid ${T.green}50`, borderRadius: 7,
                      cursor: "pointer", color: T.green,
                      fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono',monospace",
                      transition: "all .2s", whiteSpace: "nowrap"
                    }}>
                    ↓ Export HTML
                  </button>
                )}
              </div>
            </div>

            {/* Agent panels */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pipelineAgents.map(id => (
                <div key={id} style={{ animation: "kfadeup .3s ease" }}>
                  <AgentPanel agentId={id}
                    status={stages[id]?.status || "idle"}
                    output={stages[id]?.output}
                    streamText={streams[id]}
                    isActive={activeStage === id} />
                </div>
              ))}
            </div>

            {clusterData && <ClusterMap data={clusterData} />}

            {/* Error */}
            {error && (
              <div style={{
                padding: "12px 14px", borderRadius: 9,
                background: `${T.red}10`, border: `1px solid ${T.red}40`,
                fontSize: 11.5, color: T.red, animation: "kfadeup .3s ease"
              }}>
                ✗ {error}
                <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
                  Check your ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables,
                  or set it as an env var for local dev.
                </div>
              </div>
            )}

            {/* Done */}
            {done && !error && (
              <div style={{
                padding: "12px 14px", borderRadius: 9,
                background: `${T.green}10`, border: `1px solid ${T.green}40`,
                display: "flex", alignItems: "center", gap: 10,
                animation: "kfadeup .4s ease"
              }}>
                <span style={{ fontSize: 16, color: T.green }}>✓</span>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: T.green }}>
                    {detectedMode === "pipeline" && "Pipeline complete"}
                    {detectedMode === "cluster" && "Cluster mapped"}
                    {detectedMode === "refresh" && "Assessment done"}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1 }}>
                    {detectedMode === "pipeline" && "Article ready for review. Click 'Export HTML' to download."}
                    {detectedMode === "cluster" && `${clusterData?.total_articles || 11} articles planned.`}
                    {detectedMode === "refresh" && `Priority: ${stages.refresh?.output?.priority || "medium"}`}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Live log */}
            <div style={{
              background: T.navyMid, borderRadius: 10, border: `1px solid ${T.border}`, overflow: "hidden"
            }}>
              <div style={{
                padding: "9px 13px", borderBottom: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <div style={{
                  fontSize: 9.5, fontWeight: 700, color: T.teal,
                  letterSpacing: "0.08em", textTransform: "uppercase"
                }}>Live log</div>
                {running && <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: T.teal, animation: "kpulse 1s ease-in-out infinite"
                }} />}
              </div>
              <div style={{ padding: "10px 13px", maxHeight: 220, overflowY: "auto", minHeight: 80 }}>
                {log.length === 0 && (
                  <div style={{ fontSize: 10.5, color: T.muted, textAlign: "center", padding: "16px 0" }}>
                    Ready to run.
                  </div>
                )}
                {log.map((e, i) => (
                  <div key={i} style={{
                    fontSize: 10, lineHeight: 1.6, marginBottom: 4,
                    color: logColors[e.type] || T.muted, display: "flex", gap: 7,
                    animation: "kfadeup .2s ease"
                  }}>
                    <span style={{ color: T.navyLt, flexShrink: 0 }}>{e.t}</span>
                    <span>{e.msg}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Progress */}
            <div style={{
              background: T.navyMid, borderRadius: 10, border: `1px solid ${T.border}`, padding: 13
            }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: T.teal,
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 11
              }}>Stage progress</div>
              {pipelineAgents.map((id, i) => {
                const a = AGENTS[id];
                if (!a) return null;
                const st = stages[id]?.status || "idle";
                const isLast = i === pipelineAgents.length - 1;
                return (
                  <div key={id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: "50%",
                        background: st === "done" ? `${a.color}20` : st === "running" ? `${a.color}14` : T.navyLt,
                        border: `2px solid ${st === "done" ? a.color : st === "running" ? a.color : T.border}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: st === "idle" ? T.muted : a.color, flexShrink: 0,
                        transition: "all .25s",
                        animation: st === "running" ? "kpulse 1.5s ease-in-out infinite" : "none"
                      }}>
                        {st === "done" ? "✓" : a.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 600,
                          color: st === "idle" ? T.muted : T.white, transition: "color .2s"
                        }}>{a.label}</div>
                        <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>
                          {st === "idle" ? "waiting" : st === "running" ? "in progress…" : st === "done" ? "complete" : "error"}
                        </div>
                      </div>
                      {st === "done" && <span style={{ fontSize: 10, color: T.green }}>✓</span>}
                    </div>
                    {!isLast && <div style={{
                      marginLeft: 11, width: 2, height: 14,
                      background: st === "done" ? `${a.color}40` : T.navyLt,
                      margin: "2px 0 2px 11px"
                    }} />}
                  </div>
                );
              })}
            </div>

            {/* Summary card */}
            {done && detectedMode === "pipeline" && (seoOut || fcOut) && (
              <div style={{
                background: T.navyMid, borderRadius: 10,
                border: `1px solid ${T.green}30`, padding: 13, animation: "kfadeup .4s ease"
              }}>
                <div style={{
                  fontSize: 9.5, fontWeight: 700, color: T.green,
                  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 11
                }}>Output summary</div>
                {[
                  ["SEO score", `${seoOut?.total_score || "—"}/100`],
                  ["Title tag", (seoOut?.title_tag || "—").slice(0, 40) + (seoOut?.title_tag?.length > 40 ? "…" : "")],
                  ["Slug", seoOut?.slug || "—"],
                  ["Fact check", fcOut?.verdict || "—"],
                  ["Readability", seoOut?.readability_grade || "—"],
                  ["Keyword density", seoOut?.keyword_density_pct ? `${seoOut.keyword_density_pct}%` : "—"],
                  ["Word count", `${(typeof wOut === "string" ? wOut : "").split(/\s+/).filter(Boolean).length} words`],
                  ["Charts", `${stages.visuals?.output?.charts?.length || 0} generated`],
                  ["Images", `${(stages.visuals?.output?.section_images?.length || 0) + (stages.visuals?.output?.hero_image ? 1 : 0)} sourced`],
                ].map(([k, v]) => (
                  <div key={k} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "5px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10
                  }}>
                    <span style={{ color: T.muted }}>{k}</span>
                    <span style={{ color: T.white, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
                {seoOut?.total_score && (
                  <div style={{ marginTop: 10 }}>
                    <ScoreBar value={seoOut.total_score} />
                  </div>
                )}
              </div>
            )}

            {/* Architecture info */}
            <div style={{
              background: T.navyMid, borderRadius: 10, border: `1px solid ${T.border}`, padding: 13
            }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: T.teal,
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 11
              }}>Architecture</div>
              {[
                ["Model", "claude-sonnet-4-20250514"],
                ["Agents", "8 specialised agents"],
                ["Research", "SERP reverse-engineering"],
                ["Strategy", "Brief-first approach"],
                ["Scale", "Cluster + pillar model"],
                ["Quality", "Fact-check + SEO audit"],
                ["Visuals", "Charts + web images"],
                ["Export", "Styled HTML with schema"],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "5px 0", borderBottom: `1px solid ${T.border}`, fontSize: 9.5
                }}>
                  <span style={{ color: T.muted }}>{k}</span>
                  <span style={{
                    color: T.silver, fontWeight: 600, textAlign: "right", maxWidth: 180
                  }}>{v}</span>
                </div>
              ))}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div style={{
          maxWidth: 960, margin: "20px auto 0", textAlign: "center",
          fontSize: 9.5, color: T.muted, paddingTop: 14,
          borderTop: `1px solid ${T.border}`
        }}>
          Kalpi SEO Engine v2 · claude-sonnet-4-20250514 · 8 agents · Charts + images · Assignment submission
        </div>
      </div>
    </>
  );
}
