import { describe, expect, it } from 'vitest'

import {
  goToCommands,
  matchCommands,
  newCommands,
  parseCommandQuery,
} from './palette-commands'

describe('goToCommands', () => {
  it('lists the navigation pages plus Settings and Help', () => {
    const labels = goToCommands('member').map((c) => c.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Home',
        'Inbox',
        'Experiments',
        'Pipelines',
        'Settings',
        'Help',
      ]),
    )
    expect(goToCommands('member').every((c) => c.group === 'Go to')).toBe(true)
  })
})

describe('newCommands', () => {
  it('hands the project and sample in view to a new experiment', () => {
    const experiment = newCommands('/projects/p-1').find(
      (c) => c.id === 'new-experiment',
    )
    expect(experiment?.search).toEqual({ project: 'p-1' })
    const fromSample = newCommands('/samples/s-1').find(
      (c) => c.id === 'new-experiment',
    )
    expect(fromSample?.search).toEqual({ sample: 's-1' })
  })

  it('hands the dataset in view to a new analysis and an import', () => {
    const commands = newCommands('/datasets/d-1')
    expect(commands.find((c) => c.id === 'new-analysis')?.search).toEqual({
      dataset: 'd-1',
    })
    expect(commands.find((c) => c.id === 'new-import')?.search).toEqual({
      dataset: 'd-1',
    })
  })

  it('carries nothing when the page is not an object', () => {
    expect(
      newCommands('/search').find((c) => c.id === 'new-experiment')?.search,
    ).toEqual({})
  })
})

describe('matchCommands', () => {
  const all = [...goToCommands('member'), ...newCommands('/')]

  it('lists every command for an empty query', () => {
    const match = matchCommands(all, '')
    expect(match.commands).toHaveLength(all.length)
    expect(match.leads).toBe(true)
  })

  it('treats a leading verb as the group it asks for', () => {
    expect(parseCommandQuery('go to samples')).toEqual({
      group: 'Go to',
      text: 'samples',
    })
    expect(parseCommandQuery('new exp')).toEqual({ group: 'New', text: 'exp' })
    const goSamples = matchCommands(all, 'go to samples')
    expect(goSamples.commands.map((c) => c.id)).toEqual(['go-/samples'])
    expect(goSamples.leads).toBe(true)
    const newExp = matchCommands(all, 'new exp')
    expect(newExp.commands.map((c) => c.id)).toEqual(['new-experiment'])
  })

  it('lists a verb alone as its whole group', () => {
    const create = matchCommands(all, 'new')
    expect(create.commands.every((c) => c.group === 'New')).toBe(true)
    expect(create.commands.length).toBeGreaterThan(3)
  })

  it('matches a plain word in either group without leading the results', () => {
    const match = matchCommands(all, 'sample')
    expect(match.commands.map((c) => c.id)).toEqual(
      expect.arrayContaining(['go-/samples', 'new-sample']),
    )
    expect(match.leads).toBe(false)
  })

  it('matches nothing for text no command names', () => {
    expect(matchCommands(all, 'zzzz').commands).toEqual([])
  })
})
