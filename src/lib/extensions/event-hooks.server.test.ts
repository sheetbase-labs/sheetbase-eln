import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runExtensionEventHook } from './data-runtime.server'
import { clearEventHookCache, runEventHooks } from './event-hooks.server'
import type { EventHookDeps, HookEvent } from './event-hooks.server'
import type { HookStore } from './record-hooks.server'

vi.mock('./data-runtime.server', () => ({
  runExtensionEventHook: vi.fn(),
}))

const hook = {
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
    description: '',
    events: ['sample.released'],
    runner: { kind: 'python', entry: 'a:b' },
  },
} as never

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

function deps(hooks: unknown[] = [hook]): EventHookDeps & {
  saved: Array<{ title: string; userId: string }>
  store: HookStore
} {
  const saved: Array<{ title: string; userId: string }> = []
  return {
    saved,
    hooksFor: async () => hooks as never,
    store: {
      ...noStore,
      saveNote: async (note) => {
        saved.push({ title: note.title, userId: note.userId })
      },
    },
  }
}

beforeEach(() => {
  vi.mocked(runExtensionEventHook).mockReset()
  clearEventHookCache()
})

describe('runEventHooks', () => {
  it('saves what a reaction answers as notes for the person whose change it was', async () => {
    vi.mocked(runExtensionEventHook).mockResolvedValue({
      notes: [
        { title: 'Check the label' },
        { title: 'Log the freezer', body: 'Box 3' },
      ],
    })
    const d = deps()
    expect(await runEventHooks(event, d)).toBe(2)
    expect(d.saved).toEqual([
      { title: 'Check the label', userId: 'user-1' },
      { title: 'Log the freezer', userId: 'user-1' },
    ])
  })

  it('does nothing when no reaction listens, or nobody made the change', async () => {
    const none = deps([])
    expect(await runEventHooks(event, none)).toBe(0)
    expect(runExtensionEventHook).not.toHaveBeenCalled()
    expect(await runEventHooks({ ...event, actorUserId: null }, deps())).toBe(0)
    expect(runExtensionEventHook).not.toHaveBeenCalled()
  })

  it('ignores a plugin’s own audit events so a reaction cannot feed itself', async () => {
    expect(
      await runEventHooks({ ...event, entityType: 'extension' }, deps()),
    ).toBe(0)
    expect(runExtensionEventHook).not.toHaveBeenCalled()
  })

  it('keeps going when one reaction fails', async () => {
    vi.mocked(runExtensionEventHook)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ notes: [{ title: 'Second still ran' }] })
    const d = deps([hook, { ...(hook as object), id: 'other' }])
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
