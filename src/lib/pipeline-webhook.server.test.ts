import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { handlePipelineWebhook } from './pipeline-webhook.server'
import type { PipelineWebhookDeps } from './pipeline-webhook.server'
import type { ExecConnection } from './pipeline-execute.server'

vi.mock('#/env.server', () => ({ env: {} }))
vi.mock('#/lib/auth', () => ({ getAppSession: vi.fn() }))
vi.mock('./pipeline-queue.server', () => ({
  enqueuePipelineRun: vi.fn(),
  wakePipelineWorker: vi.fn(),
}))
const definition = '00000000-0000-4000-8000-000000000001'
const token = 'a'.repeat(43)
const url = `http://localhost/api/pipelines/webhook/${definition}`
function setup(
  options: {
    denied?: boolean
    enabled?: boolean
    existing?: boolean
    mismatch?: boolean
  } = {},
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('require_capability') && options.denied)
      throw new Error('42501')
    if (sql.includes('FROM api.pipeline_definitions '))
      return { rows: [{ workspace_id: definition }] }
    if (sql.includes('FROM internal.pipeline_webhook_triggers'))
      return {
        rows: [
          {
            enabled: options.enabled ?? true,
            secret_hash: createHash('sha256').update(token).digest('hex'),
            created_by_user_id: 'owner',
          },
        ],
      }
    if (sql.includes('FROM api.pipeline_runs'))
      return {
        rows: options.existing
          ? [{ id: 'existing-run', same_request: !options.mismatch }]
          : [],
      }
    if (sql.includes('FROM api.pipeline_definition_versions'))
      return { rows: [{ id: definition }] }
    if (sql.includes('start_pipeline_run')) return { rows: [{ id: 'new-run' }] }
    return { rows: [] }
  })
  const conn = {
    query,
    begin: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    end: vi.fn(),
  } as unknown as ExecConnection
  const deps: PipelineWebhookDeps = {
    getSession: vi.fn(async () => ({ user: { id: 'owner' } })),
    connect: vi.fn(async () => conn),
    enqueue: vi.fn(async () => {}),
  }
  return { deps, query, conn }
}
function delivery(secret = token, payload = '{}') {
  return new Request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'Idempotency-Key': 'event-1',
    },
    body: payload,
  })
}
describe('pipeline webhook boundary', () => {
  it('rejects unauthenticated delivery before connecting', async () => {
    const { deps } = setup()
    expect(
      (await handlePipelineWebhook(delivery('invalid'), definition, deps))
        .status,
    ).toBe(401)
    expect(deps.connect).not.toHaveBeenCalled()
  })
  it('rejects disabled and incorrect credentials', async () => {
    for (const options of [{ enabled: false }, {}]) {
      const { deps } = setup(options)
      expect(
        (
          await handlePipelineWebhook(
            delivery('b'.repeat(43)),
            definition,
            deps,
          )
        ).status,
      ).toBe(401)
      expect(deps.enqueue).not.toHaveBeenCalled()
    }
  })
  it('rechecks the credential owner permissions', async () => {
    const { deps } = setup({ denied: true })
    expect(
      (await handlePipelineWebhook(delivery(), definition, deps)).status,
    ).toBe(403)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })
  it('starts a canonical event run under the credential owner', async () => {
    const { deps, query } = setup()
    expect(
      (await handlePipelineWebhook(delivery(), definition, deps)).status,
    ).toBe(202)
    expect(
      query.mock.calls.find(([sql]) => sql.includes('start_pipeline_run')),
    ).toBeDefined()
    expect(deps.enqueue).toHaveBeenCalledWith('new-run')
  })
  it('replays the original occurrence without resolving the latest version', async () => {
    const { deps, query } = setup({ existing: true })
    expect(
      (await handlePipelineWebhook(delivery(), definition, deps)).status,
    ).toBe(202)
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM api.pipeline_definition_versions'),
      ),
    ).toBe(false)
    expect(deps.enqueue).toHaveBeenCalledWith('existing-run')
  })
  it('rejects reuse of a key with different payload', async () => {
    const { deps } = setup({ existing: true, mismatch: true })
    expect(
      (await handlePipelineWebhook(delivery(), definition, deps)).status,
    ).toBe(409)
    expect(deps.enqueue).not.toHaveBeenCalled()
  })
  it('bounds payload bytes before connecting', async () => {
    const { deps } = setup()
    expect(
      (
        await handlePipelineWebhook(
          delivery(token, JSON.stringify({ value: 'x'.repeat(65536) })),
          definition,
          deps,
        )
      ).status,
    ).toBe(413)
    expect(deps.connect).not.toHaveBeenCalled()
  })
  it('rejects cross-origin credential rotation', async () => {
    const { deps } = setup()
    const request = new Request(url, {
      method: 'PUT',
      headers: { origin: 'https://other.example' },
      body: '{"action":"rotate"}',
    })
    expect(
      (await handlePipelineWebhook(request, definition, deps)).status,
    ).toBe(403)
    expect(deps.connect).not.toHaveBeenCalled()
  })
  it('stores only a hash and returns a new token once', async () => {
    const { deps, query } = setup()
    const request = new Request(url, {
      method: 'PUT',
      headers: { origin: 'http://localhost' },
      body: '{"action":"rotate"}',
    })
    const response = await handlePipelineWebhook(request, definition, deps)
    const result = await response.json()
    expect(result.token).toHaveLength(43)
    expect(JSON.stringify(query.mock.calls)).not.toContain(result.token)
    const read = await handlePipelineWebhook(new Request(url), definition, deps)
    expect(await read.json()).not.toHaveProperty('token')
  })
})
