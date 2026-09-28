// Shared helpers for the ported app-3 area/interaction suites.
//
// The suites target the ELN's own data: ids are discovered through the
// same-origin /api/db proxy rather than hard-coded fixture ids, so a suite runs
// green against the real workspace. Playwright's networkidle never settles here
// (the app keeps an SSE connection), so suites wait for DOMContentLoaded and
// then a short settle.
import { chromium } from 'playwright'

export const base = process.argv[2]?.startsWith('http')
  ? process.argv[2]
  : 'http://localhost:3000'

export function check(ok, msg) {
  console.log(ok ? 'ok  ' : 'FAIL', msg)
  if (!ok) process.exitCode = 1
}

export async function launch(viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('hydrated')) return
    const url = m.location()?.url ?? ''
    // Dev auth-free mode: Better Auth's list-sessions answers 401.
    if (url.includes('/api/auth/list-sessions')) return
    if (
      m.text().includes('status of 401') &&
      page.url().includes('/settings/profile')
    )
      return
    errors.push(m.text())
  })
  return { browser, page, errors }
}

export async function go(page, path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
}

export async function discover() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const ids = await page.evaluate(async () => {
    const get = async (path) => {
      try {
        const r = await fetch(path)
        return r.ok ? await r.json() : []
      } catch {
        return []
      }
    }
    const [
      projects,
      experiments,
      samples,
      datasets,
      models,
      pipelines,
      templates,
      analyses,
      protocols,
    ] = await Promise.all([
      get('/api/db/rpc/project_list_summary?limit=1'),
      get('/api/db/records?kind=eq.experiment&limit=1&select=id'),
      get('/api/db/records?kind=eq.sample&limit=1&select=id'),
      get('/api/db/datasets?limit=1&select=id'),
      get('/api/db/dataset_schema_definitions?limit=1&select=id'),
      get('/api/db/pipeline_definitions?limit=1&select=id'),
      get('/api/db/notebook_templates?limit=1&select=id'),
      get('/api/db/analysis_views?limit=1&select=id'),
      get('/api/db/records?kind=eq.protocol_template&limit=1&select=id'),
    ])
    let versions = []
    if (datasets[0]?.id) {
      versions = await get(
        `/api/db/dataset_versions?dataset_id=eq.${datasets[0].id}&select=id,label&order=created_at.desc&limit=3`,
      )
    }
    return {
      project: projects[0]?.id,
      experiment: experiments[0]?.id,
      sample: samples[0]?.id,
      dataset: datasets[0]?.id,
      model: models[0]?.id,
      pipeline: pipelines[0]?.id,
      template: templates[0]?.id,
      analysis: analyses[0]?.id,
      protocol: protocols[0]?.id,
      versions,
    }
  })
  await browser.close()
  return ids
}

export async function done(browser, errors, label) {
  await browser.close()
  check(errors.length === 0, `${label}: no console or page errors`)
  if (errors.length) console.log('  errors: ' + errors.slice(0, 4).join(' | '))
}
