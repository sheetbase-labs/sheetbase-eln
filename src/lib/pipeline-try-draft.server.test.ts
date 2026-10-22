import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePipelineTryDraft } from './pipeline-run-requests.server'
import type { PipelineRunRequestDeps } from './pipeline-run-requests.server'

const trial = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./pipeline-execute.server', () => ({
  tryPipelineDraft: trial.run,
  validatePipelineResume: vi.fn(),
}))
vi.mock('#/env.server', () => ({ env: { DATABASE_URL: 'postgres://unused' } }))
vi.mock('#/lib/auth', () => ({ getAppSession: vi.fn() }))

const WS = '0e010000-0000-4000-8000-000000000101'
let userCounter = 0

function deps(signedIn = true): PipelineRunRequestDeps {
  userCounter += 1
  return {
    getSession: async () =>
      signedIn ? { user: { id: `user-${userCounter}` } } : null,
    connect: vi.fn(),
  }
}

function post(body: unknown): Request {
  return new Request('http://app.test/api/pipelines/try-draft', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => trial.run.mockReset())

describe('POST /api/pipelines/try-draft', () => {
  it('needs a signed-in person', async () => {
    const response = await handlePipelineTryDraft(post({}), deps(false))
    expect(response.status).toBe(401)
    expect(trial.run).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON or lacks the configuration', async () => {
    expect((await handlePipelineTryDraft(post('{'), deps())).status).toBe(400)
    expect(
      (await handlePipelineTryDraft(post({ workspaceId: WS }), deps())).status,
    ).toBe(400)
    expect(
      (
        await handlePipelineTryDraft(
          post({ workspaceId: 'nope', configuration: {} }),
          deps(),
        )
      ).status,
    ).toBe(400)
    expect(trial.run).not.toHaveBeenCalled()
  })

  it('hands the configuration, inputs and parameters to the trial as the signed-in person', async () => {
    trial.run.mockResolvedValue({ ok: true })
    const configuration = { transform: { statement: 'select 1' } }
    const response = await handlePipelineTryDraft(
      post({
        workspaceId: WS,
        configuration,
        inputVersions: { readings: 'dv-1' },
        parameters: { factor: 2 },
      }),
      deps(),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(trial.run).toHaveBeenCalledWith(
      expect.stringMatching(/^user-/),
      {
        workspaceId: WS,
        configuration,
        inputVersions: { readings: 'dv-1' },
        parameters: { factor: 2 },
      },
      expect.anything(),
    )
  })

  it('answers 403 for someone who cannot write in the workspace', async () => {
    trial.run.mockResolvedValue({
      ok: false,
      errorCode: 'workspace_membership_required',
      errorMessage: 'No.',
      logs: [],
    })
    const response = await handlePipelineTryDraft(
      post({ workspaceId: WS, configuration: {} }),
      deps(),
    )
    expect(response.status).toBe(403)
  })

  it('reports a draft that does not run as an answer, not a server error', async () => {
    trial.run.mockResolvedValue({
      ok: false,
      errorCode: 'transform_failed',
      errorMessage: 'Transform failed',
      logs: [],
    })
    const response = await handlePipelineTryDraft(
      post({ workspaceId: WS, configuration: {} }),
      deps(),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it('limits how often one person can try', async () => {
    trial.run.mockResolvedValue({ ok: true })
    const same: PipelineRunRequestDeps = {
      getSession: async () => ({ user: { id: 'busy-user' } }),
      connect: vi.fn(),
    }
    let last = 200
    for (let i = 0; i < 35; i += 1) {
      last = (
        await handlePipelineTryDraft(
          post({ workspaceId: WS, configuration: {} }),
          same,
        )
      ).status
    }
    expect(last).toBe(429)
  })
})
