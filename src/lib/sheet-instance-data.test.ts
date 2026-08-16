import { describe, expect, it, vi } from 'vitest'

import {
  createAdHocSheetInstance,
  createSheetInstanceFromDefinition,
  sheetInstanceFromWire,
} from './sheet-instance-data'
import { validSheetInstanceState } from './sheet-instance.test'

const id = () => crypto.randomUUID()
function wire() {
  return {
    id: id(),
    workspace_id: id(),
    project_id: null,
    notebook_record_id: null,
    source_definition_version_id: null,
    name: 'Working sheet',
    description: null,
    lifecycle: 'active' as const,
    revision: '1',
    state: validSheetInstanceState(),
    duplicated_from_instance_id: null,
    created_at: '2026-08-14T10:00:00Z',
    updated_at: '2026-08-14T10:00:00Z',
    created_by_user_id: 'user',
    updated_by_user_id: 'user',
  }
}

describe('Sheet Instance data boundary', () => {
  it('totally parses wire identity, timestamps and positive safe revision', () => {
    const parsed = sheetInstanceFromWire(wire())
    expect(parsed).toMatchObject({
      revision: 1,
      lifecycle: 'active',
      createdAt: '2026-08-14T10:00:00Z',
    })
    expect(() =>
      sheetInstanceFromWire({ ...wire(), revision: 'NaN' }),
    ).toThrow()
    expect(() =>
      sheetInstanceFromWire({ ...wire(), id: 'not-a-uuid' }),
    ).toThrow()
  })

  it('accepts Postgres timestamptz with six fractional digits', () => {
    const parsed = sheetInstanceFromWire({
      ...wire(),
      created_at: '2026-08-16T10:02:23.661876+00:00',
      updated_at: '2026-08-16T10:02:23.661876+00:00',
    })
    expect(parsed.createdAt).toBe('2026-08-16T10:02:23.661876+00:00')
  })

  it('uses explicit ad-hoc and exact Definition Version RPC payloads', async () => {
    const rpc = vi.fn().mockImplementation(async (_name, payload) => ({
      ...wire(),
      source_definition_version_id: payload.p_source_definition_version_id,
    }))
    const client: any = { rpc }
    const input = {
      workspaceId: id(),
      name: 'Sheet',
      state: validSheetInstanceState(),
    }
    await createAdHocSheetInstance(input, client)
    const sourceDefinitionVersionId = id()
    await createSheetInstanceFromDefinition(
      { ...input, sourceDefinitionVersionId, parameterInputs: [] },
      client,
    )
    expect(
      rpc.mock.calls.map((call) => call[1].p_source_definition_version_id),
    ).toEqual([null, sourceDefinitionVersionId])
    expect(rpc.mock.calls[1][0]).toBe('create_sheet_instance_from_definition')
  })
})
