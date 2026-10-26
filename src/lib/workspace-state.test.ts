import { describe, expect, it } from 'vitest'
import { applyPreset, leaf, listPaneIds, split } from '#/lib/pane-tree'
import {
  initialWorkspace,
  layoutFromTab,
  modeLabel,
  paneKind,
  paneMode,
  restoreSavedLayouts,
  restoreWorkspace,
  revisionOf,
  tabFromLayout,
  workspaceHref,
} from './workspace-state'

const origin = 'https://app.sheetbase.test'

describe('workspace destinations', () => {
  it('keeps exact scientific context and refuses non-page destinations', () => {
    const pinned =
      '/datasets/DS-0311/rows?snapshot=version-7&row=row-2&field=field-3#evidence'
    expect(workspaceHref(`${origin}${pinned}`, origin)).toBe(pinned)
    for (const href of [
      'https://other.test/datasets',
      '//other.test/',
      'javascript:alert(1)',
      '/api/db/records',
      '/sign-in?next=/datasets',
      '/client-portal',
      '/accept-invitation',
    ])
      expect(workspaceHref(href, origin)).toBeNull()
  })
})

describe('restoring a workspace', () => {
  function twoPaneState() {
    const state = initialWorkspace('/records/EXP-17/notebook')
    const tab = state.tabs[0]
    return {
      ...state,
      tabs: [
        {
          ...tab,
          panes: [
            { ...tab.panes[0], id: 'notebook' },
            {
              id: 'dataset',
              href: '/datasets/DS-31/rows?snapshot=v7&row=r2',
              title: 'Pinned readings',
              trail: [],
              forward: [],
            },
          ],
          tree: split('row', [leaf('notebook'), leaf('dataset')]),
          activeId: 'notebook',
          primaryId: 'notebook',
        },
      ],
    }
  }

  it('restores arrangement and other pinned pages but honours the address bar for the focused page', () => {
    const state = twoPaneState()
    const restored = restoreWorkspace(
      JSON.stringify(state),
      '/inbox?tab=following',
      origin,
    )
    const tab = restored.tabs[0]
    expect(tab.tree).toEqual(state.tabs[0].tree)
    expect(tab.panes.map((pane) => pane.href)).toEqual([
      '/inbox?tab=following',
      '/datasets/DS-31/rows?snapshot=v7&row=r2',
    ])
    expect(tab.primaryId).toBe('notebook')
  })

  it('falls back to a fresh workspace for the old tab-stack format or a damaged tree', () => {
    const fresh = initialWorkspace('/inbox')
    expect(
      restoreWorkspace(
        JSON.stringify({ version: 1, panes: [] }),
        '/inbox',
        origin,
      ),
    ).toEqual(fresh)
    const broken = twoPaneState()
    broken.tabs[0].tree = leaf('notebook') as never // 'dataset' is not placed
    expect(restoreWorkspace(JSON.stringify(broken), '/inbox', origin)).toEqual(
      fresh,
    )
    expect(restoreWorkspace('not json', '/inbox', origin)).toEqual(fresh)
    expect(restoreWorkspace(null, '/inbox', origin)).toEqual(fresh)
  })

  it('drops a link that names a pane that is no longer there', () => {
    const state = twoPaneState()
    state.tabs[0].links = [
      { letter: 'a', driverId: 'notebook', followerIds: ['dataset'] },
      { letter: 'b', driverId: 'notebook', followerIds: ['gone'] },
    ]
    const restored = restoreWorkspace(JSON.stringify(state), '/inbox', origin)
    expect(restored.tabs[0].links.map((link) => link.letter)).toEqual(['a'])
  })
})

describe('pane kinds and modes', () => {
  it('knows a record page from a list and gives each an icon', () => {
    expect(paneKind('/datasets/DS-0311?snapshot=S-15')).toMatchObject({
      key: 'dataset',
      icon: 'table',
      record: true,
    })
    expect(paneKind('/datasets')).toMatchObject({
      key: 'datasets',
      record: false,
    })
    expect(paneKind('/records/abc/notebook')).toMatchObject({
      key: 'experiment',
    })
  })

  it('names the mode and the revision a pane shows', () => {
    expect(modeLabel(paneMode('/experiments/EXP-0142', true))).toBe('Editing')
    expect(modeLabel(paneMode('/review/abc', true))).toBe('Reviewing')
    // a primary pane with nothing to edit shows no badge
    expect(paneMode('/', true)).toEqual({ kind: 'plain' })
    expect(paneMode('/datasets', true)).toEqual({ kind: 'plain' })
    expect(modeLabel(paneMode('/datasets/DS-0311?snapshot=S-15', false))).toBe(
      'Read-only · S-15',
    )
    expect(modeLabel(paneMode('/datasets/DS-0311', false))).toBe('Read-only')
    // signed evidence is signed whichever pane it is in
    expect(modeLabel(paneMode('/evidence/rev-1', false))).toBe('Signed')
    expect(revisionOf('/x?version=v3#h')).toBe('v3')
  })
})

describe('saved layouts', () => {
  it('round-trips arrangement and destinations without history', () => {
    const state = initialWorkspace('/datasets')
    const tab = {
      ...state.tabs[0],
      panes: [
        ...state.tabs[0].panes,
        {
          id: 'b',
          href: '/samples',
          title: 'Samples',
          trail: [{ href: '/x', title: 'x' }],
          forward: [],
        },
      ],
      tree: applyPreset('columns-2', ['initial', 'b'], 'initial'),
    }
    const saved = layoutFromTab(tab, 'layout-1', 'Bench · Today')
    const restored = restoreSavedLayouts(JSON.stringify([saved]), origin)
    expect(restored).toHaveLength(1)
    const reopened = tabFromLayout(restored[0])
    expect(reopened.name).toBe('Bench · Today')
    expect(reopened.panes.every((pane) => pane.trail.length === 0)).toBe(true)
    // fresh pane ids so two tabs of one layout never share state
    expect(reopened.panes.map((pane) => pane.id)).not.toContain('initial')
    expect(listPaneIds(reopened.tree).sort()).toEqual(
      reopened.panes.map((pane) => pane.id).sort(),
    )
  })

  it('refuses a layout pointing outside the app', () => {
    const bad = [
      {
        id: 'l',
        name: 'x',
        panes: [{ id: 'a', href: 'https://evil.test', title: 't' }],
        tree: leaf('a'),
        primaryId: 'a',
        savedAt: '2026-10-25T00:00:00Z',
      },
    ]
    expect(restoreSavedLayouts(JSON.stringify(bad), origin)).toEqual([])
  })
})
