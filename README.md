# Site Cloner

One-click website cloner → Next.js → GitHub → Vercel

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Add your Anthropic API key**
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local and add your key from https://console.anthropic.com
   ```

3. **Run locally**
   ```bash
   npm run dev
   ```

4. **Open** http://localhost:3000

## Usage

1. Paste the target URL
2. Enter your API keys:
   - **Apify token** — from https://console.apify.com/settings/integrations
   - **GitHub PAT** — from https://github.com/settings/tokens (needs `repo` scope)
   - **Vercel token** — from https://vercel.com/account/tokens
   - **GitHub username** — your GitHub username
3. Set max pages (50 is a good default)
4. Click **Clone site**

## How it works

1. **Apify** crawls the target site with a headless Chrome browser
2. **Claude** analyzes the site structure and maps routes
3. **Claude** generates a full Next.js app (layout + one page.tsx per scraped page)
4. **GitHub API** creates a new repo and pushes all files
5. **Vercel API** triggers a deployment

## Notes

- The Apify crawl takes 2–5 minutes for most sites
- Up to 10 pages are generated as full Next.js components
- The Anthropic API key runs server-side (never exposed to the browser)
- All other keys are sent from the browser to your local API route only
