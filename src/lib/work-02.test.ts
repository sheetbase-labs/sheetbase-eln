import { describe, expect, it } from 'vitest'

import { recentTone } from '#/components/v3/home/home-quiet'
import { firstRunProgress, firstRunSteps } from '#/routes/index'
import { moveListSelection, rowKey } from '#/routes/inbox'
import type { RecentItem } from '#/lib/recents'
import type { WorkItem } from '#/lib/work-items/data'

// WORK-02 — first-run checklist, Home "Continue working" status tone, and
// Inbox J/K navigation. The pure helpers live next to the routes they drive and
// are exercised here without rendering the route trees.

describe('firstRunSteps', () => {
  const base = {
    workspaceName: 'Process Development',
    signatureCertified: false,
    projects: [],
    hasOpenedProject: false,
    hasExperiment: false,
  }

  it('reads the four setup states, with only the account pre-completed', () => {
    const steps = firstRunSteps(base)
    expect(steps).toHaveLength(4)
    expect(steps[0]).toMatchObject({ label: 'Account created', done: true })
    expect(steps[1]).toMatchObject({
      label: 'Set up your electronic signature',
      done: false,
      actionTo: '/settings/signatures',
    })
    expect(steps[2]).toMatchObject({
      label: 'Open your first project',
      done: false,
      actionTo: '/projects',
    })
    expect(steps[3]).toMatchObject({
      label: 'Create an experiment from a protocol',
      done: false,
      actionTo: '/protocols',
    })
    expect(firstRunProgress(steps)).toEqual({ done: 1, total: 4 })
  })

  it('completes every item from real state, naming the first project', () => {
    const steps = firstRunSteps({
      workspaceName: 'Process Development',
      signatureCertified: true,
      projects: [
        { id: 'p-1', title: 'AAV9 process transfer', accessLevel: 'owner' },
      ],
      hasOpenedProject: true,
      hasExperiment: true,
    })
    expect(firstRunProgress(steps)).toEqual({ done: 4, total: 4 })
    expect(steps[2].hint).toContain('AAV9 process transfer')
  })

  it('does not mistake assigned Editor access for opening a project', () => {
    const steps = firstRunSteps({
      ...base,
      projects: [
        { id: 'p-1', title: 'AAV9 process transfer', accessLevel: 'editor' },
      ],
    })
    expect(steps[2]).toMatchObject({
      done: false,
      actionLabel: 'Open project',
      actionTo: '/projects/p-1',
    })
    expect(firstRunProgress(steps)).toEqual({ done: 1, total: 4 })
  })
})

describe('recentTone', () => {
  const tone = (kind: RecentItem['kind'], status: string | null) =>
    recentTone({ kind, status })

  it('maps record statuses through the shared experiment palette', () => {
    expect(tone('record', 'in_progress')).toBe('progress')
    expect(tone('record', 'approved')).toBe('ok')
    expect(tone('record', null)).toBe('none')
  })

  it('maps lifecycle objects to active/stored', () => {
    expect(tone('dataset', 'active')).toBe('progress')
    expect(tone('sheet', 'archived')).toBe('stored')
    expect(tone('project', 'retired')).toBe('stored')
  })
})

describe('Inbox J/K navigation', () => {
  const keys = ['a', 'b', 'c']

  it('advances from the implicit first row on the first J', () => {
    expect(moveListSelection(keys, null, 1)).toBe('b')
  })

  it('moves forward and backward through the ordered rows', () => {
    expect(moveListSelection(keys, 'a', 1)).toBe('b')
    expect(moveListSelection(keys, 'b', -1)).toBe('a')
  })

  it('clamps at both ends rather than wrapping', () => {
    expect(moveListSelection(keys, 'c', 1)).toBe('c')
    expect(moveListSelection(keys, 'a', -1)).toBe('a')
    expect(moveListSelection(keys, null, -1)).toBe('a')
  })

  it('treats a stale selection as the first row and handles an empty list', () => {
    expect(moveListSelection(keys, 'gone', 1)).toBe('b')
    expect(moveListSelection([], 'a', 1)).toBeNull()
  })

  it('keys rows by record id, then identifier, then title', () => {
    const item = (overrides: Partial<WorkItem>): WorkItem => ({
      kind: 'following',
      recordId: null,
      identifier: null,
      title: 'Untitled',
      projectId: null,
      reason: '',
      dueAt: null,
      state: 'needs_action',
      createdAt: null,
      ...overrides,
    })
    expect(rowKey(item({ recordId: 'r-1', identifier: 'EXP-1' }))).toBe('r-1')
    expect(rowKey(item({ identifier: 'EXP-1' }))).toBe('EXP-1')
    expect(rowKey(item({}))).toBe('Untitled')
  })
})
