import { describe, expect, it } from 'vitest'

import {
  agentFiles,
  agentTokenName,
  connectorKeyForInstrument,
} from './agent-package'

const base = {
  agentSource: '// agent',
  url: 'https://eln.example.com',
  connectorKey: 'qpcr-bench-inst-3',
  instrumentName: 'qPCR bench',
  folder: 'C:\\Results',
  credential: 'sbk_secret',
}

describe('connectorKeyForInstrument', () => {
  it('makes a key the database accepts, different for instruments that share a name', () => {
    const valid = /^[a-z][a-z0-9-]{0,48}$/
    const a = connectorKeyForInstrument('qPCR bench', 'INS-0003')
    const b = connectorKeyForInstrument('qPCR bench', 'INS-0004')
    expect(a).toMatch(valid)
    expect(a).not.toBe(b)
    expect(a).toBe('qpcr-bench-ins-0003')
  })

  it('copes with names that are empty, start with a digit or are very long', () => {
    const valid = /^[a-z][a-z0-9-]{0,48}$/
    for (const name of [
      '',
      '7500 Fast',
      'Ünïcode µ-plate reader',
      'x'.repeat(200),
    ]) {
      expect(connectorKeyForInstrument(name, 'INS-0001')).toMatch(valid)
    }
  })
})

describe('agentFiles', () => {
  it('puts the address, instrument, folder and token in the settings file', () => {
    const files = agentFiles({ ...base, system: 'windows' })
    const settings = JSON.parse(
      files.find((file) => file.path.endsWith('sheetbase-agent.json'))!.content,
    )
    expect(settings).toEqual({
      url: 'https://eln.example.com',
      connector: 'qpcr-bench-inst-3',
      dir: 'C:\\Results',
      credential: 'sbk_secret',
    })
  })

  it('adds the start file for the chosen system', () => {
    const names = (system: 'windows' | 'mac' | 'linux') =>
      agentFiles({ ...base, system }).map((file) => file.path.split('/').pop())
    expect(names('windows')).toContain('Start Sheetbase agent.bat')
    expect(names('mac')).toContain('Start Sheetbase agent.command')
    expect(names('linux')).toContain('start-sheetbase-agent.sh')
    const mac = agentFiles({ ...base, system: 'mac' }).find((file) =>
      file.path.endsWith('.command'),
    )
    expect(mac?.executable).toBe(true)
    expect(mac?.content.startsWith('#!/bin/sh')).toBe(true)
  })

  it('names the token after the instrument so a new download can replace it', () => {
    expect(agentTokenName('qpcr-bench')).toBe('Folder agent · qpcr-bench')
  })

  it('tells the reader where to save files, without developer words', () => {
    const readme = agentFiles({ ...base, system: 'windows' }).find((file) =>
      file.path.endsWith('README.txt'),
    )!.content
    expect(readme).toContain('C:\\Results')
    expect(readme).not.toMatch(/token|scope|uuid|connector/i)
  })
})
