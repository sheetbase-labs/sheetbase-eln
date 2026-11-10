import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { runExtensionRecordHook } from './data-runtime.server'
import {
  PLUGIN_CLIENT_ID,
  applyHookAnswer,
  claimsOf,
  guardRecordWrite,
  matchHooks,
  runAfterRecordHooksForEvent,
  whensOfEvent,
} from './record-hooks.server'
import type {
  HookStore,
  RecordHook,
  RecordHookDeps,
} from './record-hooks.server'
import type { ExtensionRecordHookDeclaration } from './data-points'
import type { AfterAnswer, BeforeAnswer, RecordSnapshot } from './hook-answers'

// oxlint-disable-next-line anti-slop/no-module-mocking -- A refused or broken hook is logged through the module-level logger; the suite keeps its output quiet.
vi.mock('#/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The extension runner is imported directly by the guard (RecordHookDeps carries only its runtime deps), so the suite replaces the module's export.
vi.mock('./data-runtime.server', () => ({
  runExtensionRecordHook: vi.fn(),
}))

/** The runner's arguments, from its last overload (before-or-after timing). */
type HookRunnerArgs = Parameters<typeof runExtensionRecordHook>[0]

/** The runner, mocked: each case chooses its answers and inspects the call. */
// SAFETY: `vi.mocked` returns the same function object with Vitest's mock
// surface; the overloads only narrow the answer type, which each case chooses.
const hookMock = vi.mocked(runExtensionRecordHook) as Mock<
  (args: HookRunnerArgs) => Promise<BeforeAnswer | AfterAnswer>
>

const WS = '00000000-0000-4000-8000-000000000002'
const ID = '11111111-2222-4333-8444-555555555555'

function token(
  claims: Record<string, string> = { workspace_id: WS, sub: 'user-1' },
) {
  const part = Buffer.from(JSON.stringify(claims)).toString('base64url')

  return `x.${part}.y`
}

function hook(
  id: string,
  declaration: Partial<ExtensionRecordHookDeclaration> = {},
): RecordHook {
  return {
    extensionId: 'e1',
    extensionKey: 'lab-rules',
    extensionName: 'Lab rules',
    manifestId: 'm',
    manifestVersion: '1.0.0',
    point: 'record-hooks',
    id,
    name: `plugin.lab-rules.${id}`,
    declaration: {
      id,
      title: id,
      description: '',
      when: ['created', 'edited'],
      timing: 'before',
      runner: { kind: 'python', entry: 'a:b' },
      ...declaration,
    },
  }
}

const snapshot: RecordSnapshot = {
  id: ID,
  identifier: 'EXP-1',
  kind: 'experiment',
  title: 'Titration',
  status: 'draft',
  tags: [],
  properties: {},
  custom_fields: {},
  project_id: null,
}

function store() {
  const calls: Array<[string, unknown]> = []

  const s: HookStore = {
    raiseFlag: async (a) => void calls.push(['raiseFlag', a]),
    clearFlag: async (a) => void calls.push(['clearFlag', a]),
    storeSummary: async (a) => void calls.push(['storeSummary', a]),
    storeIndex: async (a) => void calls.push(['storeIndex', a]),
    saveNote: async (a) => void calls.push(['saveNote', a]),
    changeRecord: async (a) => void calls.push(['changeRecord', a]),
  }

  return { s, calls }
}

function deps(
  hooks: RecordHook[],
  loaded: RecordSnapshot | null = snapshot,
): RecordHookDeps & { calls: Array<[string, unknown]> } {
  const { s, calls } = store()

  return {
    hooksFor: async () => hooks,
    loadRecord: async () => loaded,
    mintToken: async () => 'tok',
    store: s,
    calls,
  }
}

beforeEach(() => {
  hookMock.mockReset()
})

describe('matchHooks', () => {
  const hooks = [
    hook('a', { when: ['created'], kinds: ['sample'] }),
    hook('b', { when: ['status-changed'], statuses: ['in_review'] }),
    hook('c', { when: ['edited', 'status-changed'] }),
    hook('d', { when: ['created'], timing: 'after' }),
  ]

  it('keeps to the timing, the kind and the status asked for', () => {
    expect(
      matchHooks(hooks, 'before', ['created'], {
        kind: 'experiment',
        status: 'draft',
      }).map((m) => m.hook.id),
    ).toEqual([])
    expect(
      matchHooks(hooks, 'before', ['created'], {
        kind: 'sample',
        status: 'draft',
      }).map((m) => m.hook.id),
    ).toEqual(['a'])
    expect(
      matchHooks(hooks, 'before', ['status-changed'], {
        kind: 'sample',
        status: 'in_review',
      }).map((m) => m.hook.id),
    ).toEqual(['b', 'c'])
    expect(
      matchHooks(hooks, 'before', ['status-changed'], {
        kind: 'sample',
        status: 'closed',
      }).map((m) => m.hook.id),
    ).toEqual(['c'])
    expect(
      matchHooks(hooks, 'after', ['created'], {
        kind: 'sample',
        status: 'draft',
      }).map((m) => m.hook.id),
    ).toEqual(['d'])
  })
  it('runs a hook once, for the first of the moments that fits it', () => {
    const [match] = matchHooks(hooks, 'before', ['status-changed', 'edited'], {
      kind: 'x',
      status: 'closed',
    })

    expect(match.hook.id).toBe('c')
    expect(match.when).toBe('status-changed')
  })
})

describe('guardRecordWrite', () => {
  const create = {
    method: 'POST',
    kind: 'table' as const,
    resource: 'records',
    query: '',
    body: JSON.stringify({
      kind: 'sample',
      title: 'S-1',
      custom_fields: { a: 1 },
    }),
    token: token(),
  }

  it('does nothing when no hook is switched on', async () => {
    const d = deps([])
    const result = await guardRecordWrite(create, d)
    expect(result).toEqual({ kind: 'pass', body: create.body, warnings: [] })
    expect(runExtensionRecordHook).not.toHaveBeenCalled()
  })

  it('does nothing for writes it can’t read or tokens it can’t read', async () => {
    const d = deps([hook('a', {})])
    await guardRecordWrite({ ...create, resource: 'blocks' }, d)
    await guardRecordWrite({ ...create, token: 'nope' }, d)
    await guardRecordWrite({ ...create, method: 'GET' }, d)
    expect(runExtensionRecordHook).not.toHaveBeenCalled()
  })

  it('refuses with the plugin’s words', async () => {
    hookMock.mockResolvedValue({ refuse: 'Name it after the sample' })
    const result = await guardRecordWrite(create, deps([hook('a', {})]))
    expect(result).toEqual({
      kind: 'refused',
      message: 'Name it after the sample',
      plugin: 'Lab rules',
      hook: 'a',
    })
  })

  it('puts fills into the save, one hook seeing what the one before filled in', async () => {
    hookMock
      .mockResolvedValueOnce({ set: { custom_fields: { b: 2 } } })
      .mockImplementationOnce(async (args) => {
        const seen = args.input.record

        return {
          set: {
            custom_fields: { c: seen.custom_fields.b },
            tags: ['checked'],
          },
          warn: 'Tagged',
        }
      })

    const result = await guardRecordWrite(
      create,
      deps([hook('a', {}), hook('b', {})]),
    )

    expect(result.kind).toBe('pass')

    if (result.kind !== 'pass') return
    expect(JSON.parse(result.body!)).toMatchObject({
      custom_fields: { a: 1, b: 2, c: 2 },
      tags: ['checked'],
    })
    expect(result.warnings).toEqual(['Lab rules: Tagged'])
  })

  it('fills each row of a bulk insert', async () => {
    hookMock.mockResolvedValue({ set: { tags: ['t'] } })

    const body = JSON.stringify([
      { kind: 'sample', title: 'a' },
      { kind: 'sample', title: 'b' },
    ])

    const result = await guardRecordWrite(
      { ...create, body },
      deps([hook('a', {})]),
    )

    if (result.kind !== 'pass') throw new Error('refused')
    expect(JSON.parse(result.body!)).toEqual([
      { kind: 'sample', title: 'a', tags: ['t'] },
      { kind: 'sample', title: 'b', tags: ['t'] },
    ])
  })

  it('shows an edit with the record as it is now, and leaves a missing record to the database', async () => {
    hookMock.mockResolvedValue({})

    const patch = {
      ...create,
      method: 'PATCH',
      query: `?id=eq.${ID}`,
      body: '{"title":"New"}',
    }

    await guardRecordWrite(patch, deps([hook('a', {})]))

    const input = hookMock.mock.calls[0][0].input

    expect(input.when).toBe('edited')
    expect(input.record.title).toBe('New')
    expect(input.previous?.title).toBe('Titration')
    expect(input.changed).toEqual(['title'])
    hookMock.mockClear()
    const gone = await guardRecordWrite(patch, deps([hook('a', {})], null))
    expect(gone.kind).toBe('pass')
    expect(runExtensionRecordHook).not.toHaveBeenCalled()
  })

  it('lets the save go on, with a word, when a hook breaks', async () => {
    hookMock.mockImplementation(() => {
      throw new Error('boom')
    })
    const result = await guardRecordWrite(create, deps([hook('a', {})]))
    expect(result).toMatchObject({
      kind: 'pass',
      body: create.body,
      warnings: ['Lab rules could not check this.'],
    })
  })

  it('says so when a fill has nowhere to go', async () => {
    hookMock.mockResolvedValue({ set: { tags: ['x'] } })

    const status = {
      ...create,
      kind: 'rpc' as const,
      resource: 'set_experiment_status',
      body: JSON.stringify({ p_record_id: ID, p_status: 'closed' }),
    }

    const result = await guardRecordWrite(
      status,
      deps([hook('a', { when: ['status-changed'] })]),
    )

    if (result.kind !== 'pass') throw new Error('refused')
    expect(result.body).toBe(status.body)
    expect(result.warnings[0]).toMatch(/nowhere to put/)
  })
})

describe('whensOfEvent and the pass after a save', () => {
  const event = {
    id: 'ev-1',
    workspaceId: WS,
    actorUserId: 'user-1',
    clientId: null,
    entityType: 'record',
    entityUuid: ID,
    operation: 'update',
    recordId: ID,
    payload: {
      kind: 'experiment',
      status: 'in_review',
      changes: { status: { from: 'draft', to: 'in_review' } },
    },
  }

  it('reads create, edit and status change from the log', () => {
    expect(whensOfEvent({ ...event, operation: 'create' })?.whens).toEqual([
      'created',
    ])
    expect(whensOfEvent(event)?.whens).toEqual(['status-changed', 'edited'])
    expect(
      whensOfEvent({ ...event, payload: { changes: { title: {} } } })?.whens,
    ).toEqual(['edited'])
    expect(whensOfEvent({ ...event, entityType: 'dataset' })).toBeNull()
    expect(whensOfEvent({ ...event, operation: 'archive' })).toBeNull()
  })

  it('runs the hooks that follow and does what they answer, as the person', async () => {
    hookMock.mockResolvedValue({
      summary: 'In review',
      flags: [{ key: 'needs-qa', title: 'Needs a second look' }],
    })

    const d = deps([
      hook('s', {
        timing: 'after',
        when: ['status-changed'],
        statuses: ['in_review'],
      }),
    ])

    expect(await runAfterRecordHooksForEvent(event, d)).toBe(1)
    expect(d.calls.map((c) => c[0])).toEqual(['storeSummary', 'raiseFlag'])
    expect(d.calls[1][1]).toMatchObject({
      recordId: ID,
      key: 'needs-qa',
      actorUserId: 'user-1',
    })
  })

  it('finds the kind from the record when the log entry for an update does not carry it', async () => {
    hookMock.mockResolvedValue({ summary: 'In review' })

    const d = deps([
      hook('s', {
        timing: 'after',
        when: ['status-changed'],
        kinds: ['experiment'],
        statuses: ['in_review'],
      }),
    ])

    const update = {
      ...event,
      payload: {
        status: 'in_review',
        changes: { status: { from: 'in_progress', to: 'in_review' } },
      },
    }

    expect(await runAfterRecordHooksForEvent(update, d)).toBe(1)
  })

  it('skips changes a plugin made itself, changes nobody made, and a record it can’t see', async () => {
    const d = deps([hook('s', { timing: 'after', when: ['edited'] })])
    expect(
      await runAfterRecordHooksForEvent(
        { ...event, clientId: PLUGIN_CLIENT_ID },
        d,
      ),
    ).toBe(0)
    expect(
      await runAfterRecordHooksForEvent({ ...event, actorUserId: null }, d),
    ).toBe(0)

    const hidden = deps(
      [hook('s', { timing: 'after', when: ['edited'] })],
      null,
    )

    expect(
      await runAfterRecordHooksForEvent({ ...event, payload: {} }, hidden),
    ).toBe(0)
    expect(runExtensionRecordHook).not.toHaveBeenCalled()
  })
})

describe('applyHookAnswer', () => {
  const ctx = {
    workspaceId: WS,
    actorUserId: 'user-1',
    recordId: ID,
    eventId: 'ev-1',
    hook: { extensionKey: 'lab-rules', extensionName: 'Lab rules', id: 'h' },
  }

  it('does every part of an answer', async () => {
    const { s, calls } = store()

    const outcome = await applyHookAnswer(s, ctx, {
      notes: [{ title: 'Heads up' }],
      summary: 'All fine',
      index: [
        { index: 'fp', text: 'one', vector: [1, 0] },
        { index: 'fp', entry: 'second', text: 'two' },
        { index: 'words', text: 'three' },
      ],
      flags: [{ key: 'f', title: 'Hold' }],
      sign_off: [
        { key: 's', title: 'Sign', roles: ['reviewer'], approvals: 2 },
      ],
      clear: ['old'],
      changes: [{ set: { custom_fields: { x: 1 } } }],
    })

    expect(outcome.problems).toEqual([])
    expect(calls.map((c) => c[0])).toEqual([
      'storeSummary',
      'storeIndex',
      'storeIndex',
      'raiseFlag',
      'raiseFlag',
      'clearFlag',
      'changeRecord',
      'saveNote',
    ])
    expect(calls[1][1]).toMatchObject({
      index: 'fp',
      entries: [
        { entry: 'main', body: 'one', vector: [1, 0] },
        { entry: 'second', body: 'two' },
      ],
    })
    expect(calls[4][1]).toMatchObject({
      kind: 'sign_off',
      roles: ['reviewer'],
      approvals: 2,
      independent: true,
    })
    expect(calls[6][1]).toMatchObject({ actorUserId: 'user-1', recordId: ID })
  })

  it('keeps going when a step fails, and says which', async () => {
    const { s } = store()
    s.storeSummary = async () => {
      throw new Error('db down')
    }

    const outcome = await applyHookAnswer(s, ctx, {
      summary: 'x',
      flags: [{ key: 'f', title: 'Hold' }],
    })

    expect(outcome.done).toEqual(['flag f'])
    expect(outcome.problems).toEqual(['summary: db down'])
  })

  it('settles each ordered write before later writes to the same record or flag', async () => {
    const indexes: string[] = []
    const notes: string[] = []
    const cleared: string[] = []
    const raised: string[] = []
    const flags = new Set<string>()
    let reading: unknown

    const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    const orderedStore: HookStore = {
      storeSummary: async () => undefined,
      storeIndex: async ({ index }) => {
        if (index === 'first') await delay()
        indexes.push(index)
      },
      raiseFlag: async ({ key, title }) => {
        if (key === 'held') await delay()
        flags.add(key)
        raised.push(title)
      },
      clearFlag: async ({ key }) => {
        if (key === 'held') await delay()
        flags.delete(key)
        cleared.push(key)
      },
      changeRecord: async ({ set }) => {
        const value = set.custom_fields?.reading

        if (value === 1) await delay()
        reading = value
      },
      saveNote: async ({ title }) => {
        if (title === 'First') await delay()
        notes.push(title)
      },
    }

    const outcome = await applyHookAnswer(orderedStore, ctx, {
      index: [
        { index: 'first', text: 'µL' },
        { index: 'second', text: 'β' },
      ],
      flags: [
        { key: 'held', title: 'Hold' },
        { key: 'obsolete', title: 'Old hold' },
      ],
      sign_off: [
        { key: 'held', title: 'First review', roles: ['reviewer'] },
        { key: 'obsolete', title: 'Second review', roles: ['reviewer'] },
      ],
      clear: ['held', 'obsolete'],
      changes: [
        { set: { custom_fields: { reading: 1 } } },
        { set: { custom_fields: { reading: 2 } } },
      ],
      notes: [{ title: 'First' }, { title: 'Second' }],
    })

    expect(outcome.problems).toEqual([])
    expect(flags.size).toBe(0)
    expect(reading).toBe(2)
    expect(indexes).toEqual(['first', 'second'])
    expect(raised).toEqual([
      'Hold',
      'Old hold',
      'First review',
      'Second review',
    ])
    expect(cleared).toEqual(['held', 'obsolete'])
    expect(notes).toEqual(['First', 'Second'])
    expect(outcome.done).toEqual([
      'index first',
      'index second',
      'flag held',
      'flag obsolete',
      'sign-off held',
      'sign-off obsolete',
      'clear held',
      'clear obsolete',
      `change ${ID}`,
      `change ${ID}`,
      'note First',
      'note Second',
    ])
  })

  it('cannot change a record with nobody to do it as, or leave notes with no event', async () => {
    const { s, calls } = store()

    const outcome = await applyHookAnswer(
      s,
      { ...ctx, actorUserId: null, eventId: null },
      {
        changes: [{ set: { tags: ['x'] } }],
        notes: [{ title: 'n' }],
      },
    )

    expect(calls).toEqual([])
    expect(outcome.problems).toHaveLength(1)
  })

  it('can change another record by id, never one it was not told about by name', async () => {
    const { s, calls } = store()
    const other = '99999999-2222-4333-8444-555555555555'
    await applyHookAnswer(s, ctx, {
      changes: [{ record: other, set: { tags: ['x'] } }],
    })
    expect(calls[0][1]).toMatchObject({ recordId: other })
  })
})

describe('claimsOf', () => {
  it('reads the workspace and the person from a verified token', () => {
    expect(claimsOf(token())).toEqual({
      workspaceId: WS,
      actorUserId: 'user-1',
    })
    expect(claimsOf(token({ sub: 'x' }))).toBeNull()
    expect(claimsOf('garbage')).toBeNull()
  })
})
