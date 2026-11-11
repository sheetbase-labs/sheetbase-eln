import { describe, expect, it } from 'vitest'

import { parseProjectImport } from './project-import'

const clients = [{ id: 'c1', label: 'CL-017 · AAV Partners' }]
const members = [{ id: 'u1', label: 'Gareth P.' }]

describe('parseProjectImport', () => {
  it('matches clients by code or name and leads by name', () => {
    const { rows } = parseProjectImport(
      'Name,Client,Lead,Stage,Started\nAAV9 run,CL-017,Gareth P.,QC,2026-11-11\nLVV,aav partners,,,',
      clients,
      members,
    )

    expect(rows[0].input).toMatchObject({
      title: 'AAV9 run',
      clientId: 'c1',
      leadUserId: 'u1',
      stage: 'QC',
      startedOn: '2026-11-11',
    })
    expect(rows[1].input).toMatchObject({ clientId: 'c1', leadUserId: null })
  })

  it('refuses a line it cannot match, with the line number', () => {
    const { rows } = parseProjectImport(
      'Name,Client,Started\n,CL-017,\nX,CL-999,\nY,,11/11/2026',
      clients,
      members,
    )

    expect(rows.map((r) => [r.line, r.input === null])).toEqual([
      [2, true],
      [3, true],
      [4, true],
    ])
    expect(rows[1].problem).toContain('CL-999')
  })

  it('needs a Name column', () => {
    expect(parseProjectImport('Client\nCL-017', clients, members)).toEqual({
      rows: [],
      missingName: true,
    })
  })
})
