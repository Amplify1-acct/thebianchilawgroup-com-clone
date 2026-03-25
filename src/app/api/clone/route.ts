import { NextRequest, NextResponse } from 'next/server'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function pollApify(runId: string, token: string, maxWaitMs = 600000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await sleep(5000)
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
    const d = await r.json()
    const status = d.data?.status
    if (status === 'SUCCEEDED') return d.data.defaultDatasetId
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Apify run ${status}`)
    }
  }
  throw new Error('Apify timed out after 10 minutes')
}

async function callClaude(system: string, user: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })
  const d = await resp.json()
  if (d.error) throw new Error('Claude: ' + d.error.message)
  return d.content.map((c: { type: string; text?: string }) => c.text || '').join('')
}

async function pushToGithub(token: string, user: string, repo: string, path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString('base64')
  let sha: string | undefined
  try {
    const r = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${path}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    })
    if (r.ok) { const d = await r.json(); sha = d.sha }
  } catch {}
  const body: Record<string, string> = { message, content: encoded }
  if (sha) body.sha = sha
  const resp = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const e = await resp.json()
    throw new Error(`GitHub push ${path}: ${e.message}`)
  }
}

export async function POST(req: NextRequest) {
  const { url, apifyKey, githubKey, vercelKey, githubUser, maxPages, repoName } = await req.json()

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const send = async (data: object) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  const hostname = new URL(url).hostname.replace('www.', '')
  const finalRepo = repoName || hostname.replace(/\./g, '-') + '-clone'

  ;(async () => {
    try {
      // STEP 1: Apify
      await send({ step: 'scrape', status: 'running', msg: 'Starting Apify crawler...' })

      const apifyResp = await fetch(`https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${apifyKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url }],
          maxCrawlPages: maxPages || 50,
          crawlerType: 'playwright:chrome',
          saveHtml: false,
          saveMarkdown: true,
          removeCookieWarnings: true
        })
      })

      if (!apifyResp.ok) {
        const e = await apifyResp.json()
        throw new Error('Apify start failed: ' + (e.message || apifyResp.status))
      }

      const apifyData = await apifyResp.json()
      const runId = apifyData.data.id
      await send({ step: 'scrape', status: 'running', msg: `Crawling... run ID: ${runId}` })

      const datasetId = await pollApify(runId, apifyKey)
      await send({ step: 'scrape', status: 'running', msg: 'Fetching scraped pages...' })

      const itemsResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&format=json&limit=${maxPages || 50}`)
      const items = await itemsResp.json()
      await send({ step: 'scrape', status: 'done', msg: `Scraped ${items.length} pages`, count: items.length })

      // STEP 2: Analyze
      await send({ step: 'analyze', status: 'running', msg: 'Analyzing site structure...' })

      const pageList = items.map((p: { url: string; title?: string; markdown?: string }) => ({
        url: p.url,
        title: p.title || '',
        h1: p.markdown?.split('\n').find((l: string) => l.startsWith('# '))?.slice(2) || ''
      }))

      const structureRaw = await callClaude(
        'You are a Next.js architect. Return ONLY valid JSON, no markdown, no backticks.',
        `Site: ${url}
Pages (${pageList.length}): ${JSON.stringify(pageList, null, 2)}

Return JSON:
{
  "siteName": "string",
  "primaryColor": "#hex",
  "routes": [{"path": "/", "component": "HomePage", "title": "string"}],
  "navLinks": [{"label": "string", "href": "string"}],
  "footerLinks": [{"label": "string", "href": "string"}]
}`
      )

      let siteStructure: { siteName: string; primaryColor: string; routes: Array<{path: string; component: string; title: string}>; navLinks: Array<{label: string; href: string}>; footerLinks: Array<{label: string; href: string}> }
      try { siteStructure = JSON.parse(structureRaw) }
      catch { siteStructure = { siteName: hostname, primaryColor: '#1a1a1a', routes: [], navLinks: [], footerLinks: [] } }

      await send({ step: 'analyze', status: 'done', msg: `${siteStructure.routes?.length || 0} routes mapped`, siteName: siteStructure.siteName })

      // STEP 3: Generate
      await send({ step: 'generate', status: 'running', msg: 'Generating layout...' })

      const files: Array<{ path: string; content: string }> = []

      const layoutCode = await callClaude(
        'You are an expert Next.js developer. Return ONLY TypeScript code, no markdown, no backticks.',
        `Generate a Next.js 14 App Router layout.tsx for: ${siteStructure.siteName}
Primary color: ${siteStructure.primaryColor}
Nav links: ${JSON.stringify(siteStructure.navLinks)}
Footer links: ${JSON.stringify(siteStructure.footerLinks)}

Requirements:
- Import Playfair Display + Nunito Sans from Google Fonts
- Full nav with all links, responsive
- Full footer with all links
- TypeScript, proper metadata export
- No Tailwind — use inline styles or CSS-in-JS style objects`
      )
      files.push({ path: 'src/app/layout.tsx', content: layoutCode })

      const keyPages = items.slice(0, 10)
      for (let i = 0; i < keyPages.length; i++) {
        const page = keyPages[i] as { url: string; title?: string; markdown?: string; text?: string }
        await send({ step: 'generate', status: 'running', msg: `Generating page ${i + 1}/${keyPages.length}: ${page.url}` })

        const pagePath = new URL(page.url).pathname
        const componentName = pagePath === '/'
          ? 'HomePage'
          : pagePath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'Page'
        const nextPath = pagePath === '/' ? 'src/app/page.tsx' : `src/app${pagePath}/page.tsx`

        const content = page.markdown || page.text || ''
        const pageCode = await callClaude(
          'You are an expert Next.js developer. Return ONLY TypeScript code, no markdown, no backticks.',
          `Generate a complete Next.js 14 App Router page for: ${page.url}
Title: ${page.title || ''}
Primary color: ${siteStructure.primaryColor}

FULL PAGE CONTENT (replicate ALL of this — every section, heading, paragraph, list):
${content.slice(0, 7000)}

Requirements:
- Include every piece of content from above — match word count and depth
- All statute citations, phone numbers, attorney names, addresses exactly as written
- Inline styles only, no Tailwind
- TypeScript
- export default function ${componentName}()`
        )
        files.push({ path: nextPath, content: pageCode })
      }

      // Config files
      files.push({ path: 'package.json', content: JSON.stringify({
        name: finalRepo, version: '0.1.0', private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { typescript: '^5.0.0', '@types/react': '^18.0.0', '@types/node': '^20.0.0' }
      }, null, 2) })

      files.push({ path: 'next.config.js', content: `/** @type {import('next').NextConfig} */\nconst nextConfig = { images: { unoptimized: true } }\nmodule.exports = nextConfig` })

      files.push({ path: 'tsconfig.json', content: JSON.stringify({
        compilerOptions: {
          target: 'es5', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true,
          skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true,
          moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
          jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }], paths: { '@/*': ['./src/*'] }
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
        exclude: ['node_modules']
      }, null, 2) })

      files.push({ path: '.gitignore', content: `node_modules\n.next\n.env\n.env.local\n` })

      await send({ step: 'generate', status: 'done', msg: `${files.length} files generated` })

      // STEP 4: GitHub
      await send({ step: 'github', status: 'running', msg: `Creating repo ${githubUser}/${finalRepo}...` })

      const createRepoResp = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `token ${githubKey}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify({ name: finalRepo, description: `Next.js clone of ${url}`, private: false, auto_init: true })
      })

      if (!createRepoResp.ok) {
        const e = await createRepoResp.json()
        if (!e.errors?.[0]?.message?.includes('already exists')) throw new Error('GitHub: ' + e.message)
      }

      await sleep(2000)

      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        await send({ step: 'github', status: 'running', msg: `Pushing ${i + 1}/${files.length}: ${f.path}` })
        await pushToGithub(githubKey, githubUser, finalRepo, f.path, f.content, `Add ${f.path}`)
      }

      await send({ step: 'github', status: 'done', msg: `${files.length} files pushed`, repoUrl: `https://github.com/${githubUser}/${finalRepo}` })

      // STEP 5: Vercel
      await send({ step: 'vercel', status: 'running', msg: 'Triggering Vercel deployment...' })

      const vercelResp = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${vercelKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalRepo,
          gitSource: { type: 'github', repoSlug: finalRepo, ref: 'main', org: githubUser },
          projectSettings: { framework: 'nextjs' }
        })
      })

      const vData = await vercelResp.json()
      const liveUrl = vData.url ? `https://${vData.url}` : `https://${finalRepo}.vercel.app`

      await send({ step: 'vercel', status: 'done', msg: 'Deployment triggered!', liveUrl, repoUrl: `https://github.com/${githubUser}/${finalRepo}` })
      await send({ step: 'complete', status: 'done', liveUrl, repoUrl: `https://github.com/${githubUser}/${finalRepo}`, fileCount: files.length, pageCount: items.length })

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await send({ step: 'error', status: 'error', msg: message })
    } finally {
      await writer.close()
    }
  })()

  return new NextResponse(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
