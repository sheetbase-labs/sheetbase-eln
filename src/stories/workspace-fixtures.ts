import { leaf } from '#/lib/pane-tree'
import type { SavedLayout, WorkspaceTab } from '#/lib/workspace-state'

/** Static workspace fixtures the multiplex stories share. */
export const TABS: WorkspaceTab[] = [
  {
    id: 'tab-1',
    name: 'Stability review',
    panes: [
      {
        id: 'pane-1',
        href: '/experiments/exp-1',
        title: 'Virus stability at 25 °C',
        identifier: 'EXP-2026-0042',
        trail: [],
        forward: [],
      },
      {
        id: 'pane-2',
        href: '/datasets/ds-1',
        title: 'HPLC purity series',
        identifier: 'DS-0107',
        trail: [],
        forward: [],
      },
    ],
    tree: leaf('pane-1'),
    activeId: 'pane-1',
    primaryId: 'pane-1',
    links: [],
    dirty: false,
  },
  {
    id: 'tab-2',
    name: 'Untitled',
    panes: [
      {
        id: 'pane-3',
        href: '/samples',
        title: 'Samples',
        trail: [],
        forward: [],
      },
    ],
    tree: leaf('pane-3'),
    activeId: 'pane-3',
    primaryId: 'pane-3',
    links: [],
    dirty: true,
  },
]

export const LAYOUTS: SavedLayout[] = [
  {
    id: 'layout-1',
    name: 'Review and data',
    panes: [
      { id: 'a', href: '/experiments/exp-1', title: 'Experiment' },
      { id: 'b', href: '/datasets/ds-1', title: 'Dataset' },
    ],
    tree: leaf('a'),
    primaryId: 'a',
    savedAt: '2026-11-01T09:00:00.000Z',
  },
]
