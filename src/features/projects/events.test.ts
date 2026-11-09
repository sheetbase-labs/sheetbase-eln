import { describe, expect, it } from 'vitest'

import { PROJECTS_EVENTS } from './events'
import { PIPELINE_TRIGGER_EVENTS } from '#/lib/pipeline-schedule'
import { mapEventType } from '#/lib/webhook-events'

describe('projects events', () => {
  it('names each change the database emits', () => {
    expect(mapEventType('folder', 'create')).toBe('folder.created')
    expect(mapEventType('folder', 'update')).toBe('folder.updated')
    expect(mapEventType('folder', 'delete')).toBe('folder.deleted')
    expect(mapEventType('folder', 'move')).toBe('folder.items_moved')
    expect(mapEventType('system', 'create', { ok: true })).toBe(
      'audit.verified',
    )
    expect(
      mapEventType('api_credential', 'create', { kind: 'sql_login' }),
    ).toBe('sql_login.created')
    expect(
      mapEventType('api_credential', 'revoke', { kind: 'sql_login' }),
    ).toBe('sql_login.revoked')
    expect(mapEventType('record', 'move')).toBe('record.moved')
  })

  it('lets pipelines start on projects, folders and the audit check', () => {
    for (const name of [
      'project.created',
      'project.archived',
      'folder.created',
      'folder.items_moved',
      'audit.verified',
    ])
      expect(PIPELINE_TRIGGER_EVENTS, name).toContain(name)
  })

  it('declares only events with a name the catalogue can send', () => {
    for (const entry of PROJECTS_EVENTS) expect(entry.wireName).toBe(entry.name)
  })
})
