# Kalpi SEO Content Engine v2

An end-to-end SEO blog automation system for **Kalpi** (Indian investing platform), powered by Claude AI. Combines three SEO strategies into one unified pipeline.

## Architecture: Combined Approach (A + B + C)

| Approach | What it does | Where in the pipeline |
|----------|-------------|----------------------|
| **B — SERP Reverse-Engineering** | Analyses top-ranking competitors, extracts their structure, identifies content gaps | Stage 1: SERP Intelligence agent |
| **A — Brief-First Strategy** | Creates a detailed content brief before writing begins (mirrors agency workflow) | Stage 2: Content Brief agent |
| **Multi-Agent Pipeline** | Specialized agents with distinct roles: write → fact-check → SEO score | Stages 3–5 |
| **C — Topic Cluster Model** | Plans pillar + 10 satellite articles with internal linking map | Cluster Planner mode |
| **Dynamic Refresh** | Re-scans SERPs to recommend content updates for published articles | Refresh Monitor mode |

## 8 Specialized Agents

| # | Agent | Role | Output |
|---|-------|------|--------|
| 1 | **SERP Intelligence** | Scans competitors on Indian fintech domains (Smallcase, Groww, Zerodha, etc.) | JSON: top pages, gaps, semantic keywords, FAQs |
| 2 | **Content Brief** | Converts SERP data into a strategic writing plan with Kalpi's unique angle | JSON: H2s, keywords, links, image suggestions, meta |
| 3 | **Writer** | Drafts the full article following the brief, with SEO structure built in | Markdown with meta/image/CTA placeholders |
| 4 | **Fact Checker** | Validates claims against SEBI rules, tax limits, realistic return ranges | JSON: verdict, issues, required disclaimers |
| 5 | **SEO Scorer** | Scores the article 0–100 across 7 dimensions, generates schema + OG tags | JSON: score breakdown, title tag, slug, schema |
| 6 | **Visual Engine** | Generates chart data specs + web image search queries for the article | JSON: hero image, section images, Chart.js configs |
| 7 | **Cluster Planner** | Maps a pillar page + 10 satellite articles with difficulty and intent mix | JSON: satellites with keywords, angles, link map |
| 8 | **Refresh Monitor** | Assesses ranking health of published articles, recommends updates | JSON: health score, decline reasons, refresh tasks |

## Image & Chart System

The Visual Engine agent analyses the finished article and generates:

### Web Images (Unsplash)
- **Hero image**: Full-width background with text overlay, sourced from Unsplash based on topic
- **Section images**: 2–3 images placed after relevant H2 headings
- All images include SEO-optimised `alt` text and `loading="lazy"`
- Hero image also used for `og:image` and `twitter:image` meta tags

### Data Charts (Chart.js)
- **2–3 charts** with realistic Indian investing data, rendered via Chart.js in the exported HTML
- Chart types: line (growth over time), bar (comparisons), pie/doughnut (allocations)
- Examples generated: SIP growth projections, asset allocation breakdowns, fund category returns, expense ratio comparisons
- Responsive design with proper labels, legends, and source captions
- Charts are interactive in the browser (hover for values)

### How it works
1. Visual Engine agent reads the article's H2 headings and content
2. Generates JSON specs: Unsplash search queries + Chart.js data configs
3. During HTML export, specs are converted to real `<img>` tags and `<canvas>` charts
4. Charts use Chart.js loaded from CDN — no build step needed

## Three Operating Modes

- **Full Pipeline** — Runs agents 1→2→3→4→5→6 sequentially, then exports as styled HTML with images and charts
- **Cluster Planner** — Runs agents 1→6 to map a complete content ecosystem
- **Refresh Monitor** — Runs agent 7 to assess an existing article's ranking health

## Output: Downloadable HTML Blog

The exported HTML file includes:
- Semantic HTML5 structure with proper heading hierarchy
- `<meta>` tags (description, robots, canonical URL)
- Open Graph tags with `og:image` from Unsplash
- Twitter Card tags with image
- JSON-LD Article schema
- JSON-LD FAQ schema (from the FAQ section)
- Hero image with text overlay (sourced from Unsplash)
- 2–3 section images with SEO alt text
- 2–3 interactive Chart.js data visualisations
- Responsive CSS (mobile-friendly)
- CTA section linking to Kalpi app
- Financial disclaimers
- SEO score badge

---

## Setup

### Prerequisites
- Node.js 18+
- An Anthropic API key

### Local Development

```bash
# 1. Clone and install
git clone <your-repo>
cd kalpi-seo-agent
npm install

# 2. Set your API key
#    Create a .env file in the project root:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

#    Or export it directly:
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start dev server
npm run dev
```

The Vite dev server proxies `/api/claude` requests to Anthropic's API using your local env var. No backend server needed for local dev.

Open `http://localhost:5173` in your browser.

### Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy
vercel

# 3. Set the API key in Vercel dashboard:
#    Settings → Environment Variables → Add:
#    Name:  ANTHROPIC_API_KEY
#    Value: sk-ant-...
```

The `api/claude.js` edge function handles all API calls in production — your key never reaches the browser.

---

## Project Structure

```
kalpi-seo-agent/
├── api/
│   └── claude.js          # Vercel edge function (proxies to Anthropic)
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx           # React entry point
│   └── App.jsx            # Full application (single-file for simplicity)
├── index.html
├── package.json
├── vite.config.js         # Vite config with dev proxy
├── vercel.json            # Vercel routing config
└── README.md
```

## How the SEO Pipeline Works (Step by Step)

1. **User enters a topic** (e.g., "What is SIP investing?")
2. **SERP agent** searches the competitive landscape — which pages rank, what headings they use, what gaps exist
3. **Brief agent** takes that SERP data and creates a strategic plan — Kalpi's unique angle, required sections, keyword targets, internal/external links
4. **Writer agent** follows the brief to produce a 1200–1800 word article with proper markdown structure, image placeholders, FAQ section, and CTA
5. **Fact checker** validates all financial claims (SEBI rules, tax limits, return expectations)
6. **SEO scorer** grades the article 0–100, generates the title tag, URL slug, schema markup, and OG tags
7. **Visual engine** analyses the article and generates chart data (Chart.js configs) + image search queries (Unsplash)
8. **User exports** as a styled HTML file with embedded images, interactive charts, and full SEO metadata

## Dynamic Improvement Over Time

The **Refresh Monitor** enables ongoing SEO maintenance:
- Feed a previously published article's topic back into the system
- It simulates a SERP re-scan to check ranking health
- Identifies decline reasons (competitor updates, algorithm changes, stale data)
- Recommends specific refresh tasks with impact/effort estimates
- Suggests new keywords to add and sections to update

The **Cluster Planner** enables strategic content scaling:
- Input a broad topic (e.g., "mutual funds")
- System plans a pillar page + 10 satellite articles
- Each satellite has a unique keyword, search intent, difficulty rating, and angle
- Internal link map connects all pieces for topical authority
- Run each satellite through the Full Pipeline individually

## Key Design Decisions

- **Single-file app** — All logic in one `App.jsx` for easy review and modification
- **Streaming responses** — Each agent streams output in real-time so you can watch it work
- **Graceful degradation** — If one agent fails, the pipeline continues with defaults
- **No database** — Stateless by design; each run is independent
- **Edge function** — API key stays server-side, never exposed to the browser

## Tech Stack

- **Frontend**: React 18 + Vite
- **AI**: Claude claude-sonnet-4-20250514 via Anthropic Messages API
- **Hosting**: Vercel (edge functions for API proxy)
- **Styling**: Inline styles (no CSS framework dependency)
