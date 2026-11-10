import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  describeDestination,
  guardStorageMove,
  isStorageMove,
} from './storage-rules.server'
import type { StorageGuardDeps, StorageRule } from './storage-rules.server'
import { buildStorageTree } from '#/lib/storage-locations'
import type { StorageNode } from '#/lib/storage-locations'
import { guardRecordWrite } from './record-hooks.server'
import type { HookStore } from './record-hooks.server'
import type { ExtensionStorageRuleDeclaration } from './data-points'
import type { ExtensionRuntimeDeps } from './runtime.server'
import type { RecordSnapshot } from './hook-answers'

/** The plugin's Python, as the runner would run it; each case sets the verdict. */
const executePython = vi.fn<ExtensionRuntimeDeps['executePython']>(
  async () => ({ rows: [], logs: [], runtime: 'unit' }),
)

function declaration(id: string): ExtensionStorageRuleDeclaration {
  return {
    id,
    title: id,
    description: `Keeps samples in place ${id}.`,
    runner: { kind: 'python', entry: 'a:b' },
  }
}

/**
 * The installed plugin the real rule runtime opens: one enabled plugin whose
 * manifest declares the two rules these cases switch between. Only Python is
 * faked, at the transport seam the runtime already takes.
 */
const runtime: ExtensionRuntimeDeps = {
  loadInstall: async () => ({
    id: 'e1',
    key: 'lab-inventory',
    name: 'Lab inventory',
    status: 'enabled',
    disabledPoints: [],
    manifest: {
      id: 'acme.lab-inventory',
      name: 'Lab inventory',
      version: '1.0.0',
      source: 'package:acme.lab-inventory',
      capabilities: [],
      scopes: ['projects:read'],
      contributions: {
        'storage-rules': [declaration('a'), declaration('b')],
      },
    },
  }),
  loadPackage: async () => ({
    'python/storage.py': 'def cold_chain(value): return {}',
  }),
  executePython,
  audit: async () => undefined,
  now: () => 0,
}

/** A hook store no storage move reaches: reaching one is a mistake, not a pass. */
function unusedHookStore(): HookStore {
  const unused = () =>
    Promise.reject(new Error('a storage move never touches the hook store'))

  return {
    raiseFlag: unused,
    clearFlag: unused,
    storeSummary: unused,
    storeIndex: unused,
    saveNote: unused,
    changeRecord: unused,
  }
}

const WS = '00000000-0000-4000-8000-000000000002'
const SAMPLE = '11111111-2222-4333-8444-555555555555'
const POSITION = '99999999-2222-4333-8444-555555555555'
const claims = { workspaceId: WS, actorUserId: 'user-1' }

function node(
  level: StorageNode['level'],
  id: string,
  parentId: string | null,
  extra: Partial<StorageNode> = {},
): StorageNode {
  return {
    level,
    id,
    parentId,
    name: id,
    code: null,
    position: null,
    unitType: null,
    temperatureMinC: null,
    temperatureMaxC: null,
    rows: null,
    cols: null,
    archivedAt: null,
    held: 0,
    ...extra,
  }
}

const tree = buildStorageTree(
  [
    node('site', 'Site', null),
    node('room', 'Room', 'Site'),
    node('unit', 'Ultra', 'Room', {
      unitType: 'freezer',
      temperatureMinC: -90,
      temperatureMaxC: -70,
    }),
    node('shelf', 'Shelf 1', 'Ultra'),
    node('rack', 'Rack A', 'Shelf 1'),
    node('box', 'Box 3', 'Rack A', { rows: 3, cols: 3 }),
  ],
  new Map([['Box 3', 8]]),
)

const sample: RecordSnapshot = {
  id: SAMPLE,
  identifier: 'SMP-1',
  kind: 'sample',
  title: 'Serum',
  status: 'active',
  tags: [],
  properties: { storageLocation: 'Bench' },
  custom_fields: {},
  project_id: null,
}

function rule(id: string): StorageRule {
  return {
    extensionId: 'e1',
    extensionKey: 'lab-inventory',
    extensionName: 'Lab inventory',
    manifestId: 'm',
    manifestVersion: '1.0.0',
    point: 'storage-rules',
    id,
    name: `plugin.lab-inventory.${id}`,
    declaration: {
      id,
      title: id,
      description: '',
      runner: { kind: 'python', entry: 'a:b' },
    },
  }
}

function deps(rules: StorageRule[]): StorageGuardDeps {
  return {
    runtime,
    rulesFor: async () => rules,
    loadRecord: async () => sample,
    readTree: async () => tree,
    readPosition: async () => ({ boxId: 'Box 3', label: 'B2' }),
  }
}

const move = {
  resource: 'move_sample_to_position',
  body: JSON.stringify({
    p_record_id: SAMPLE,
    p_to_position_id: POSITION,
    p_expected_metadata_version: 1,
  }),
  token: 'x',
}

beforeEach(() => executePython.mockReset())

describe('isStorageMove', () => {
  it('knows the calls that put a sample somewhere', () => {
    expect(isStorageMove('move_sample_to_position')).toBe(true)
    expect(isStorageMove('transfer_sample')).toBe(true)
    expect(isStorageMove('edit_sample')).toBe(false)
  })
})

describe('describeDestination', () => {
  it('reads the path, temperature, unit and fill from the storage tree', async () => {
    const place = await describeDestination(
      move.resource,
      JSON.parse(move.body),
      'x',
      deps([]),
    )

    expect(place).toEqual({
      path: ['Site', 'Room', 'Ultra', 'Shelf 1', 'Rack A', 'Box 3'],
      box: 'Box 3',
      position: 'B2',
      temperatureC: { min: -90, max: -70 },
      unitType: 'freezer',
      capacity: 9,
      held: 8,
    })
  })
  it('describes a typed place by its words', async () => {
    const place = await describeDestination(
      'transfer_sample',
      { p_to_location: 'Lab / Bench 2' },
      'x',
      deps([]),
    )

    expect(place?.path).toEqual(['Lab', 'Bench 2'])
    expect(place?.position).toBeNull()
  })
})

describe('guardStorageMove', () => {
  it('does nothing for other calls or when no rule is switched on', async () => {
    expect(
      await guardStorageMove(
        { ...move, resource: 'edit_sample' },
        claims,
        deps([rule('a')]),
      ),
    ).toBeNull()
    expect(await guardStorageMove(move, claims, deps([]))).toBeNull()
    expect(executePython).not.toHaveBeenCalled()
  })

  it('hands the rule the sample and the place, and stops on a refusal with its words', async () => {
    executePython.mockResolvedValue({
      rows: [{ status: 'refuse', message: 'Too warm.' }],
      logs: [],
      runtime: 'unit',
    })

    const result = await guardStorageMove(
      move,
      claims,
      deps([rule('a'), rule('b')]),
    )

    expect(result).toEqual({
      kind: 'refused',
      message: 'Too warm.',
      plugin: 'Lab inventory',
      hook: 'a',
    })
    expect(executePython).toHaveBeenCalledTimes(1)
    expect(executePython.mock.calls[0][0].parameters).toMatchObject({
      kind: 'operation',
      entry: 'a:b',
      input: {
        sample: { identifier: 'SMP-1' },
        to: { temperatureC: { min: -90, max: -70 } },
        from: 'Bench',
      },
    })
  })

  it('collects warnings from every rule and lets the move go', async () => {
    executePython
      .mockResolvedValueOnce({
        rows: [{ status: 'warn', message: 'Nearly full.' }],
        logs: [],
        runtime: 'unit',
      })
      .mockResolvedValueOnce({
        rows: [{ status: 'ok' }],
        logs: [],
        runtime: 'unit',
      })

    const result = await guardStorageMove(
      move,
      claims,
      deps([rule('a'), rule('b')]),
    )

    expect(result).toEqual({
      kind: 'pass',
      warnings: ['Lab inventory: Nearly full.'],
    })
  })

  it('never blocks a move because a rule broke', async () => {
    executePython.mockRejectedValueOnce(new Error('boom'))
    const result = await guardStorageMove(move, claims, deps([rule('a')]))
    expect(result).toEqual({
      kind: 'pass',
      warnings: ['Lab inventory could not check this.'],
    })
  })

  it('leaves a sample the person cannot see to the database', async () => {
    const hidden = { ...deps([rule('a')]), loadRecord: async () => null }
    expect(await guardStorageMove(move, claims, hidden)).toBeNull()
    expect(executePython).not.toHaveBeenCalled()
  })
})

describe('guardRecordWrite on a move', () => {
  const token = `x.${Buffer.from(
    JSON.stringify({ workspace_id: WS, sub: 'user-1' }),
  ).toString('base64url')}.y`

  const recordDeps = (rules: StorageRule[]) => ({
    hooksFor: async () => [],
    loadRecord: async () => sample,
    store: unusedHookStore(),
    storage: deps(rules),
  })

  it('refuses the write the way a hook before a save does', async () => {
    executePython.mockResolvedValue({
      rows: [{ status: 'refuse', message: 'Too warm.' }],
      logs: [],
      runtime: 'unit',
    })

    const result = await guardRecordWrite(
      { method: 'POST', kind: 'rpc', query: '', ...move, token },
      recordDeps([rule('a')]),
    )

    expect(result).toMatchObject({ kind: 'refused', message: 'Too warm.' })
  })

  it('lets it through, with the warning, untouched', async () => {
    executePython.mockResolvedValue({
      rows: [{ status: 'warn', message: 'Nearly full.' }],
      logs: [],
      runtime: 'unit',
    })

    const result = await guardRecordWrite(
      { method: 'POST', kind: 'rpc', query: '', ...move, token },
      recordDeps([rule('a')]),
    )

    expect(result).toEqual({
      kind: 'pass',
      body: move.body,
      warnings: ['Lab inventory: Nearly full.'],
    })
  })
})
