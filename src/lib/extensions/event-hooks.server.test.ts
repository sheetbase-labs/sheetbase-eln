import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventHookDeps, HookEvent } from './event-hooks.server'
import type { HookStore } from './record-hooks.server'
import type { ExtensionRuntimeDeps } from './runtime.server'

vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('FORMULA_DATABASE_URL', 'postgresql://test:test@localhost:1/test')

vi.stubEnv('BETTER_AUTH_SECRET', 'extension-unit-test-secret-not-for-use')

vi.stubEnv('PGRST_JWT_SECRET', 'extension-unit-test-token-not-for-use')

const { clearEventHookCache, runEventHooks } =
  await import('./event-hooks.server')

afterAll(() => vi.unstubAllEnvs())

const hook: Awaited<ReturnType<EventHookDeps['hooksFor']>>[number] = {
  extensionId: 'e1',
  extensionKey: 'bench-extras',
  extensionName: 'Bench extras',
  manifestId: 'm',
  manifestVersion: '1.0.0',
  point: 'event-hooks',
  id: 'on-release',
  name: 'plugin.bench-extras.on-release',
  declaration: {
    id: 'on-release',
    title: 'React to a release',
    description: 'React to a released sample.',
    events: ['sample.released'],
    runner: { kind: 'python', entry: 'a:b' },
  },
}

const event: HookEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  actorUserId: 'user-1',
  recordId: null,
  entityType: 'sample',
  entityId: '00000000-0000-4000-8000-000000000003',
  name: 'sample.released',
  data: { id: 'x' },
}

const noStore = {
  raiseFlag: async () => undefined,
  clearFlag: async () => undefined,
  storeSummary: async () => undefined,
  storeIndex: async () => undefined,
  saveNote: async () => undefined,
  changeRecord: async () => undefined,
} satisfies HookStore

function deps(hooks: Awaited<ReturnType<EventHookDeps['hooksFor']>> = [hook]) {
  const saved: Array<{ title: string; userId: string }> = []

  const executePython = vi.fn<ExtensionRuntimeDeps['executePython']>(
    async () => ({
      rows: [],
      logs: [],
      runtime: 'unit',
    }),
  )

  const runtime: ExtensionRuntimeDeps = {
    loadInstall: async () => ({
      id: 'e1',
      key: 'bench-extras',
      name: 'Bench extras',
      status: 'enabled',
      disabledPoints: [],
      manifest: {
        id: 'bench.extras',
        name: 'Bench extras',
        version: '1.0.0',
        source: 'package:bench.extras',
        capabilities: [],
        scopes: ['projects:read'],
        contributions: {
          'event-hooks': hooks.map((entry) => entry.declaration),
        },
      },
    }),
    loadPackage: async () => ({ 'python/a.py': 'def b(value): return {}' }),
    executePython,
    audit: async () => undefined,
    now: () => 0,
  }

  return {
    saved,
    executePython,
    runtime,
    hooksFor: async () => hooks,
    store: {
      ...noStore,
      saveNote: async (note) => {
        saved.push({ title: note.title, userId: note.userId })
      },
    },
  } satisfies EventHookDeps & {
    saved: typeof saved
    executePython: typeof executePython
  }
}

beforeEach(() => {
  clearEventHookCache()
})

describe('runEventHooks', () => {
  it('saves what a reaction answers as notes for the person whose change it was', async () => {
    const d = deps()
    d.executePython.mockResolvedValueOnce({
      rows: [
        {
          notes: [
            { title: 'Check the label' },
            { title: 'Log the freezer', body: 'Box 3' },
          ],
        },
      ],
      logs: [],
      runtime: 'unit',
    })
    expect(await runEventHooks(event, d)).toBe(2)
    expect(d.saved).toEqual([
      { title: 'Check the label', userId: 'user-1' },
      { title: 'Log the freezer', userId: 'user-1' },
    ])
  })

  it('does nothing when no reaction listens, or nobody made the change', async () => {
    const none = deps([])
    expect(await runEventHooks(event, none)).toBe(0)
    expect(none.executePython).not.toHaveBeenCalled()

    const nobody = deps()
    expect(await runEventHooks({ ...event, actorUserId: null }, nobody)).toBe(0)
    expect(nobody.executePython).not.toHaveBeenCalled()
  })

  it('ignores a plugin’s own audit events so a reaction cannot feed itself', async () => {
    const d = deps()
    expect(await runEventHooks({ ...event, entityType: 'extension' }, d)).toBe(
      0,
    )
    expect(d.executePython).not.toHaveBeenCalled()
  })

  it('keeps going when one reaction fails', async () => {
    const d = deps([
      hook,
      {
        ...hook,
        id: 'other',
        declaration: { ...hook.declaration, id: 'other' },
      },
    ])

    d.executePython
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        rows: [{ notes: [{ title: 'Second still ran' }] }],
        logs: [],
        runtime: 'unit',
      })
    expect(await runEventHooks(event, d)).toBe(1)
    expect(d.saved).toEqual([{ title: 'Second still ran', userId: 'user-1' }])
  })

  it('never throws, even when the lookup fails', async () => {
    const d: EventHookDeps = {
      hooksFor: async () => {
        throw new Error('db down')
      },
      store: noStore,
    }

    await expect(runEventHooks(event, d)).resolves.toBe(0)
  })
})
