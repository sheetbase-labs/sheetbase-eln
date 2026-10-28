import { describe, expect, it } from 'vitest'
import { listPaneIds } from '#/lib/pane-tree'
import {
  activeTab,
  addTab,
  arrange,
  closePane,
  closeTab,
  editingPaneFor,
  focusPane,
  linkOf,
  makeDriver,
  makePrimary,
  nextTab,
  openBeside,
  paneAtNumber,
  pinToShelf,
  promoteFromShelf,
  recordNavigation,
  setPaneMeta,
  stepBack,
  stepForward,
  toggleLink,
} from './workspace-actions'
import { initialWorkspace } from './workspace-state'

let counter = 0
const id = () => `p${(counter += 1)}`

function bench() {
  // EXP-0142 (editing) with DS-0311 and DEV-0007 opened beside
  let state = initialWorkspace('/experiments/EXP-0142')
  state = setPaneMeta(state, 'initial', {
    title: 'Harvest clarification',
    identifier: 'EXP-0142',
  })
  state = openBeside(state, {
    href: '/datasets/DS-0311?snapshot=S-15',
    newId: 'ds',
  }).state
  state = openBeside(state, {
    href: '/instruments/DEV-0007',
    newId: 'dev',
  }).state
  return state
}

describe('opening beside', () => {
  it('keeps the editing pane primary when a record is opened beside it', () => {
    const state = bench()
    const tab = activeTab(state)
    expect(tab.primaryId).toBe('initial')
    expect(listPaneIds(tab.tree)).toEqual(['initial', 'ds', 'dev'])
    expect(tab.activeId).toBe('dev')
  })

  it('hands primary to the new pane when it is opened from a list', () => {
    let state = initialWorkspace('/datasets')
    state = openBeside(state, { href: '/datasets/DS-0311', newId: 'ds' }).state
    expect(activeTab(state).primaryId).toBe('ds')
  })

  it('focuses a page that is already open instead of opening it twice, unless asked', () => {
    const state = bench()
    const again = openBeside(state, {
      href: '/datasets/DS-0311?snapshot=S-15',
      newId: 'x',
    })
    expect(again.created).toBe(false)
    expect(again.paneId).toBe('ds')
    const copy = openBeside(state, {
      href: '/datasets/DS-0311?snapshot=S-15',
      newId: 'copy',
      duplicate: true,
    })
    expect(copy.created).toBe(true)
  })

  it('treats a record link and the default view it redirects to as the same page', () => {
    let state = initialWorkspace('/projects/P1/experiments')
    state = openBeside(state, { href: '/experiments/E1', newId: 'a' }).state
    // The pane's address becomes the redirect target once the route resolves.
    state = recordNavigation(state, 'a', '/experiments/E1/notebook')
    const again = openBeside(state, { href: '/experiments/E1', newId: 'b' })
    expect(again.created).toBe(false)
    expect(again.paneId).toBe('a')
    expect(activeTab(again.state).panes).toHaveLength(2)
    const other = openBeside(state, { href: '/experiments/E10', newId: 'c' })
    expect(other.created).toBe(true)
  })
})

describe('closing and primary', () => {
  it('moves primary and focus to a neighbour when the primary pane closes', () => {
    const state = closePane(bench(), 'initial')
    const tab = activeTab(state)
    expect(tab.panes.map((pane) => pane.id).sort()).toEqual(['dev', 'ds'])
    expect(tab.panes.some((pane) => pane.id === tab.primaryId)).toBe(true)
  })

  it('never closes the last pane', () => {
    const state = initialWorkspace('/inbox')
    expect(closePane(state, 'initial')).toBe(state)
  })

  it('makes one pane primary at a time', () => {
    const state = makePrimary(bench(), 'ds')
    expect(activeTab(state).primaryId).toBe('ds')
  })

  it('numbers panes in reading order for ⌘1–⌘9', () => {
    const tab = activeTab(bench())
    expect([1, 2, 3].map((n) => paneAtNumber(tab, n))).toEqual([
      'initial',
      'ds',
      'dev',
    ])
    expect(paneAtNumber(tab, 4)).toBeUndefined()
  })
})

describe('trail', () => {
  it('pushes the page you leave, and steps back and forward through it', () => {
    let state = bench()
    state = recordNavigation(state, 'ds', '/samples/SMP-2248')
    state = recordNavigation(state, 'ds', '/instruments/DEV-0007')
    let pane = activeTab(state).panes.find((p) => p.id === 'ds')!
    expect(pane.trail.map((step) => step.href)).toEqual([
      '/datasets/DS-0311?snapshot=S-15',
      '/samples/SMP-2248',
    ])
    const back = stepBack(state, 'ds')!
    expect(back.href).toBe('/samples/SMP-2248')
    pane = activeTab(back.state).panes.find((p) => p.id === 'ds')!
    expect(pane.forward.map((step) => step.href)).toEqual([
      '/instruments/DEV-0007',
    ])
    const forward = stepForward(back.state, 'ds')!
    expect(forward.href).toBe('/instruments/DEV-0007')
  })

  it('does not add a step for a change of search or hash on the same page', () => {
    let state = bench()
    state = recordNavigation(
      state,
      'ds',
      '/datasets/DS-0311?snapshot=S-15&row=88',
    )
    const pane = activeTab(state).panes.find((p) => p.id === 'ds')!
    expect(pane.trail).toEqual([])
    expect(pane.href).toBe('/datasets/DS-0311?snapshot=S-15&row=88')
  })

  it('can jump back several steps at once and returns null with no history', () => {
    let state = bench()
    expect(stepBack(state, 'ds')).toBeNull()
    state = recordNavigation(state, 'ds', '/samples/A')
    state = recordNavigation(state, 'ds', '/samples/B')
    const back = stepBack(state, 'ds', 2)!
    expect(back.href).toBe('/datasets/DS-0311?snapshot=S-15')
  })
})

describe('links', () => {
  it('links the focused pane with its neighbour, with the focused pane driving', () => {
    let state = focusPane(bench(), 'initial')
    state = toggleLink(state)
    const tab = activeTab(state)
    expect(tab.links).toEqual([
      { letter: 'a', driverId: 'initial', followerIds: ['ds'] },
    ])
    expect(linkOf(tab, 'ds')?.letter).toBe('a')
  })

  it('unlinks, and dissolves a link left with one pane', () => {
    let state = toggleLink(focusPane(bench(), 'initial'))
    state = toggleLink(state)
    expect(activeTab(state).links).toEqual([])
  })

  it('gives each new link the next colour and lets another pane drive', () => {
    let state = toggleLink(focusPane(bench(), 'initial')) // a: initial -> ds
    state = toggleLink(focusPane(state, 'dev')) // dev's neighbour ds is linked, so dev joins a
    expect(activeTab(state).links).toHaveLength(1)
    expect(activeTab(state).links[0].followerIds.sort()).toEqual(['dev', 'ds'])
    state = makeDriver(state, 'ds')
    expect(activeTab(state).links[0].driverId).toBe('ds')
    expect(activeTab(state).links[0].followerIds.sort()).toEqual([
      'dev',
      'initial',
    ])
  })

  it('drops a pane from its link when it closes', () => {
    let state = toggleLink(focusPane(bench(), 'initial'))
    state = closePane(state, 'ds')
    expect(activeTab(state).links).toEqual([])
  })
})

describe('layout presets', () => {
  it('duplicates the focused page into missing panes and never closes one', () => {
    const state = arrange(initialWorkspace('/datasets'), 'columns-3', id)
    expect(activeTab(state).panes).toHaveLength(3)
    expect(listPaneIds(activeTab(state).tree)).toHaveLength(3)
    const rows = arrange(bench(), 'rows-2', id)
    expect(activeTab(rows).panes).toHaveLength(3)
  })
})

describe('shelf', () => {
  it('keeps a record once and promotes it to a pane beside the focused one', () => {
    let state = bench()
    const item = {
      id: 's1',
      href: '/samples/SMP-2248',
      title: 'C-150 filtrate',
      identifier: 'SMP-2248',
    }
    state = pinToShelf(pinToShelf(state, item), { ...item, id: 's2' })
    expect(state.shelf).toHaveLength(1)
    expect(state.shelfOpen).toBe(true)
    const promoted = promoteFromShelf(state, 's1', 'smp')!
    expect(promoted.state.shelf).toHaveLength(0)
    expect(
      activeTab(promoted.state).panes.some((pane) => pane.id === 'smp'),
    ).toBe(true)
  })
})

describe('workspace tabs', () => {
  it('adds, cycles and closes tabs and never closes the last one', () => {
    let state = initialWorkspace('/inbox')
    state = addTab(state, '/datasets', { tabId: 't2', paneId: 'q' })
    expect(state.activeTabId).toBe('t2')
    expect(nextTab(state).activeTabId).toBe('initial-tab')
    state = closeTab(state, 't2')
    expect(state.tabs).toHaveLength(1)
    expect(closeTab(state, 'initial-tab')).toBe(state)
  })
})

describe('the pane that edits', () => {
  it('names the primary pane and says it shows a different record', () => {
    const tab = activeTab(bench())
    const ds = tab.panes.find((p) => p.id === 'ds')!
    expect(editingPaneFor(tab, ds)).toEqual({
      identifier: 'EXP-0142',
      sameRecord: false,
    })
  })

  it('says same record only when another pane shows the same page', () => {
    let state = bench()
    state = openBeside(state, {
      href: '/experiments/EXP-0142?snapshot=S-14',
      newId: 'copy',
    }).state
    const tab = activeTab(state)
    const copy = tab.panes.find((p) => p.id === 'copy')!
    expect(editingPaneFor(tab, copy)?.sameRecord).toBe(true)
  })

  it('has nothing to say about the primary pane itself', () => {
    const tab = activeTab(bench())
    expect(editingPaneFor(tab, tab.panes[0])).toBeUndefined()
  })
})
