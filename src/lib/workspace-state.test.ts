import { describe, expect, it } from 'vitest'
import { singleStack, splitStack } from '@sheetbase-labs/sheetbase-shared'
import {
  initialWorkspace,
  restoreWorkspace,
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

  it('restores arrangement and other pinned pages but honours the address bar for the focused page', () => {
    const state = {
      version: 1,
      panes: [
        {
          id: 'notebook',
          href: '/records/EXP-17/notebook',
          title: 'Experiment',
        },
        {
          id: 'dataset',
          href: '/datasets/DS-31/rows?snapshot=v7&row=r2',
          title: 'Pinned readings',
        },
      ],
      layout: splitStack(
        singleStack(['notebook'], 'left'),
        'left',
        'dataset',
        'row',
        false,
      ),
      activeId: 'notebook',
    }
    const restored = restoreWorkspace(
      JSON.stringify(state),
      '/inbox?tab=following',
      origin,
    )
    expect(restored.layout).toEqual(state.layout)
    expect(restored.panes.map((pane) => pane.href)).toEqual([
      '/inbox?tab=following',
      '/datasets/DS-31/rows?snapshot=v7&row=r2',
    ])
  })

  it('rejects corrupt or duplicate placements instead of mounting a page twice', () => {
    const initial = initialWorkspace('/datasets')
    for (const saved of [
      '{',
      JSON.stringify({ ...initial, version: 2 }),
      JSON.stringify({
        ...initial,
        panes: [{ ...initial.panes[0], href: '/api/db/records' }],
      }),
      JSON.stringify({
        ...initial,
        layout: singleStack(['initial', 'initial']),
      }),
    ])
      expect(restoreWorkspace(saved, '/inbox', origin)).toEqual(
        initialWorkspace('/inbox'),
      )
  })
})
