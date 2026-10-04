import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { config } from 'dotenv'
import pg from 'pg'

// Run from the parent checkout, against its deliberately configured auth-free app:
// node proj-01-timezone-repro.mjs http://127.0.0.1:3100
// Requires agent-browser, installed dependencies, and MIGRATION_DATABASE_URL for
// exact temporary-fixture cleanup. Does not reset or alter existing seed rows.
config({ path: ['.env.local', '.env'], quiet: true })
const baseURL = process.argv[2]
assert(baseURL, 'Pass the running auth-free app URL as the first argument')
assert(process.env.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL required for cleanup')
const projectId = '00000000-0000-4000-8000-000000000320'
const title = 'Clarification train selected'
const session = `proj-date-${process.pid}`
const screenshot = resolve(process.argv[3] ?? '.amp/in/artifacts/proj-01-milestone-timezone.png')
const browser = (...args) => execFileSync('agent-browser', ['--session', session, ...args], {
  encoding: 'utf8', timeout: 90_000,
})
async function api(path, input) {
  const response = await fetch(new URL(`/api/db/${path}`, baseURL), {
    ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(60_000),
  })
  assert(response.ok, `${path}: HTTP ${response.status}`)
  return response.json()
}

let taskId
try {
  const created = await api('rpc/create_study_task', {
    p_workspace_id: '00000000-0000-4000-8000-000000000300',
    p_title: title, p_task_type: 'milestone', p_project_id: projectId,
    p_status: 'in_progress', p_due_at: '2026-09-29T00:00:00+01:00',
    p_timezone: 'Europe/London', p_position: 1, p_progress_percent: 50,
    p_linked_experiment_record_id: '00000000-0000-4000-8000-000000000351',
  })
  assert.equal(typeof created.id, 'string')
  taskId = created.id
  const [wire] = await api(`study_tasks?id=eq.${taskId}&project_id=eq.${projectId}&select=id,project_id,title,due_at,timezone`)
  assert.equal(wire.id, taskId)
  assert.equal(wire.project_id, projectId)
  assert.equal(wire.title, title)
  assert.equal(wire.timezone, 'Europe/London')
  assert.equal(Date.parse(wire.due_at), Date.parse('2026-09-28T23:00:00Z'))
  const date = (timeZone) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', timeZone,
  }).format(new Date(wire.due_at))
  assert.equal(date('UTC'), '28 Sept')
  assert.equal(date(wire.timezone), '29 Sept')
  console.log(JSON.stringify({ wire, UTC: date('UTC'), nativeTimezone: date(wire.timezone) }, null, 2))
  browser('open', new URL('/projects', baseURL).href)
  browser('set', 'viewport', '1280', '900', '2')
  browser('wait', 'button[aria-label="Show details for AAV9 process transfer"]')
  browser('find', 'role', 'button', 'click', '--name', 'Show details for AAV9 process transfer')
  browser('wait', '--text', `${title} · 29 Sept`)
  console.log(browser('eval', `(() => {
    const text = document.querySelector('[aria-label="Project details"]').innerText;
    if (!text.includes('Clarification train selected · 29 Sept') ||
        text.includes('Clarification train selected · 28 Sept')) throw new Error(text);
    return text;
  })()`))
  await mkdir(resolve(screenshot, '..'), { recursive: true })
  console.log(browser('screenshot', screenshot))
  console.log('Native due-date wire and DOM assertions passed. No interception or seed reset.')
} finally {
  try { browser('close') } catch { /* A failed browser launch may leave no session. */ }
  if (taskId) {
    const database = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
    await database.connect()
    try {
      const result = await database.query(
        'DELETE FROM api.study_tasks WHERE id=$1 AND title=$2 AND project_id=$3 RETURNING id',
        [taskId, title, projectId],
      )
      assert.equal(result.rowCount, 1, 'Cleanup must remove exactly the generated acceptance task')
      console.log(`Removed temporary acceptance task ${taskId}`)
    } finally { await database.end() }
  }
}
