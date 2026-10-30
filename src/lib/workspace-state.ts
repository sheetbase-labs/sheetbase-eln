import { z } from 'zod'

import { t } from '#/copy'

import {
  applyPreset,
  hasPane,
  isPaneTree,
  leaf,
  listPaneIds,
} from '#/lib/pane-tree'
import type { LayoutPreset, PaneTree } from '#/lib/pane-tree'
import type { IconName } from '#/components/v3/icons'

/** Public/authentication, API and standalone reference routes keep their shell. */
export function workspaceHref(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin)
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      /^\/(?:api(?:\/|$)|sign-in(?:\/|$)|client-portal(?:\/|$)|accept-invitation(?:\/|$)|docs(?:\/|$)|foundations(?:\/|$)|r(?:\/|$)|sheetbase-components(?:\/|$)|component-compare(?:\/|$))/.test(
        url.pathname,
      )
    )
      return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

/** One step of a pane's own history. The page it is showing now is not in it. */
export interface TrailStep {
  href: string
  title: string
  identifier?: string
  /** When the pane moved on from this page; what a saved trail reports. */
  leftAt?: string
}

export interface WorkspacePane {
  id: string
  href: string
  title: string
  /** The record's own ID (`EXP-0142`), once the page has shown one. */
  identifier?: string
  /** Earlier pages in this pane, oldest first. */
  trail: TrailStep[]
  /** Pages stepped back from, nearest first, so Forward can return to them. */
  forward: TrailStep[]
}

export type LinkLetter = 'a' | 'b' | 'c'
export const linkLetters: readonly LinkLetter[] = ['a', 'b', 'c']

/**
 * A relationship between panes. One drives; the rest follow its scroll. The
 * letter picks the colour (cyan, violet, amber), which lives only on the chip.
 */
export interface PaneLink {
  letter: LinkLetter
  driverId: string
  followerIds: string[]
}

export interface WorkspaceTab {
  id: string
  name: string
  panes: WorkspacePane[]
  tree: PaneTree
  /** The pane with focus. */
  activeId: string
  /** The one pane that may change things; every other pane is read-only. */
  primaryId: string
  links: PaneLink[]
  /** Set when the tab was opened from, or saved as, a named layout. */
  layoutId?: string
  /** Changed since it was last saved (or never saved). */
  dirty: boolean
}

export interface ShelfItem {
  id: string
  href: string
  title: string
  identifier?: string
  /** The pane it was kept from, e.g. `EXP-0142`. */
  from?: string
}

export interface WorkspaceState {
  version: 2
  tabs: WorkspaceTab[]
  activeTabId: string
  shelf: ShelfItem[]
  shelfOpen: boolean
}

export function pageTitle(href: string) {
  const part = href.split(/[?#]/)[0]?.split('/').filter(Boolean).at(-1)
  if (!part) return t('projects.workspaceState.home')
  if (/^[\da-f-]{36}$/i.test(part)) return t('projects.workspaceState.record')
  return part
    .replaceAll('-', ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export interface PaneKind {
  /** Stable key for tests and styling. */
  key: string
  label: string
  icon: IconName
  /** A single record the scientist can work in, as opposed to a list or tool. */
  record: boolean
}

const KINDS: { match: RegExp; kind: PaneKind }[] = [
  {
    match: /^\/(?:experiments|records)\/[^/]+/,
    kind: {
      key: 'experiment',
      label: t('projects.paneKinds.experiment'),
      icon: 'flask',
      record: true,
    },
  },
  {
    match: /^\/datasets\/[^/]+/,
    kind: {
      key: 'dataset',
      label: t('projects.paneKinds.dataset'),
      icon: 'table',
      record: true,
    },
  },
  {
    match: /^\/samples\/[^/]+/,
    kind: {
      key: 'sample',
      label: t('projects.paneKinds.sample'),
      icon: 'tube',
      record: true,
    },
  },
  {
    match: /^\/materials\/[^/]+/,
    kind: {
      key: 'material',
      label: t('projects.paneKinds.material'),
      icon: 'box',
      record: true,
    },
  },
  {
    match: /^\/protocols\/[^/]+/,
    kind: {
      key: 'protocol',
      label: t('projects.paneKinds.protocol'),
      icon: 'protocol',
      record: true,
    },
  },
  {
    match: /^\/templates\/[^/]+/,
    kind: {
      key: 'template',
      label: t('projects.paneKinds.template'),
      icon: 'template',
      record: true,
    },
  },
  {
    match: /^\/analysis\/[^/]+/,
    kind: {
      key: 'analysis',
      label: t('projects.paneKinds.analysis'),
      icon: 'chart',
      record: true,
    },
  },
  {
    match: /^\/projects\/[^/]+/,
    kind: {
      key: 'project',
      label: t('projects.paneKinds.project'),
      icon: 'folder',
      record: true,
    },
  },
  {
    match: /^\/instruments\/[^/]+/,
    kind: {
      key: 'instrument',
      label: t('projects.paneKinds.instrument'),
      icon: 'plug',
      record: true,
    },
  },
  {
    match: /^\/sheets\/[^/]+/,
    kind: {
      key: 'sheet',
      label: t('projects.paneKinds.sheet'),
      icon: 'table',
      record: true,
    },
  },
  {
    match: /^\/pipelines\/[^/]+/,
    kind: {
      key: 'pipeline',
      label: t('projects.paneKinds.pipeline'),
      icon: 'pipeline',
      record: true,
    },
  },
  {
    match: /^\/models\/[^/]+/,
    kind: {
      key: 'model',
      label: t('projects.paneKinds.model'),
      icon: 'schema',
      record: true,
    },
  },
  {
    match: /^\/(?:review|evidence)\/[^/]+/,
    kind: {
      key: 'review',
      label: t('projects.paneKinds.review'),
      icon: 'edit',
      record: true,
    },
  },
  {
    match: /^\/datasets/,
    kind: {
      key: 'datasets',
      label: t('projects.paneKinds.datasets'),
      icon: 'table',
      record: false,
    },
  },
  {
    match: /^\/(?:experiments)/,
    kind: {
      key: 'experiments',
      label: t('projects.paneKinds.experiments'),
      icon: 'flask',
      record: false,
    },
  },
  {
    match: /^\/samples/,
    kind: {
      key: 'samples',
      label: t('projects.paneKinds.samples'),
      icon: 'tube',
      record: false,
    },
  },
  {
    match: /^\/protocols/,
    kind: {
      key: 'protocols',
      label: t('projects.paneKinds.protocols'),
      icon: 'protocol',
      record: false,
    },
  },
  {
    match: /^\/templates/,
    kind: {
      key: 'templates',
      label: t('projects.paneKinds.templates'),
      icon: 'template',
      record: false,
    },
  },
  {
    match: /^\/materials/,
    kind: {
      key: 'materials',
      label: t('projects.paneKinds.materials'),
      icon: 'box',
      record: false,
    },
  },
  {
    match: /^\/instruments/,
    kind: {
      key: 'instruments',
      label: t('projects.paneKinds.instruments'),
      icon: 'plug',
      record: false,
    },
  },
  {
    match: /^\/pipelines/,
    kind: {
      key: 'pipelines',
      label: t('projects.paneKinds.pipelines'),
      icon: 'pipeline',
      record: false,
    },
  },
  {
    match: /^\/models/,
    kind: {
      key: 'models',
      label: t('projects.paneKinds.models'),
      icon: 'schema',
      record: false,
    },
  },
  {
    match: /^\/inbox/,
    kind: {
      key: 'inbox',
      label: t('projects.paneKinds.inbox'),
      icon: 'inbox',
      record: false,
    },
  },
  {
    match: /^\/schedule/,
    kind: {
      key: 'schedule',
      label: t('projects.paneKinds.schedule'),
      icon: 'calendar',
      record: false,
    },
  },
  {
    match: /^\/projects/,
    kind: {
      key: 'projects',
      label: t('projects.paneKinds.projects'),
      icon: 'folder',
      record: false,
    },
  },
  {
    match: /^\/analysis/,
    kind: {
      key: 'analyses',
      label: t('projects.paneKinds.analyses'),
      icon: 'chart',
      record: false,
    },
  },
  {
    match: /^\/settings/,
    kind: {
      key: 'settings',
      label: t('projects.paneKinds.settings'),
      icon: 'settings',
      record: false,
    },
  },
  {
    match: /^\/help/,
    kind: {
      key: 'help',
      label: t('projects.paneKinds.help'),
      icon: 'info',
      record: false,
    },
  },
  {
    match: /^\/search/,
    kind: {
      key: 'search',
      label: t('projects.paneKinds.search'),
      icon: 'search',
      record: false,
    },
  },
  {
    match: /^\/import/,
    kind: {
      key: 'import',
      label: t('projects.paneKinds.import'),
      icon: 'upload',
      record: false,
    },
  },
  {
    match: /^\/scan/,
    kind: {
      key: 'scan',
      label: t('projects.paneKinds.scan'),
      icon: 'scan',
      record: false,
    },
  },
  {
    match: /^\/readings/,
    kind: {
      key: 'readings',
      label: t('projects.paneKinds.readings'),
      icon: 'clock',
      record: false,
    },
  },
  {
    match: /^\/promotions/,
    kind: {
      key: 'promotions',
      label: t('projects.paneKinds.promotions'),
      icon: 'table',
      record: false,
    },
  },
  {
    match: /^\/$/,
    kind: {
      key: 'home',
      label: t('projects.paneKinds.home'),
      icon: 'home',
      record: false,
    },
  },
]

const GENERIC_KIND: PaneKind = {
  key: 'page',
  label: t('projects.paneKinds.page'),
  icon: 'info',
  record: false,
}

/** What kind of page an address is, for the pane header's icon and rules. */
export function paneKind(href: string): PaneKind {
  const path = href.split(/[?#]/)[0] ?? ''
  return KINDS.find((entry) => entry.match.test(path))?.kind ?? GENERIC_KIND
}

export type PaneMode =
  | { kind: 'editing' }
  | { kind: 'plain' }
  | { kind: 'reviewing' }
  | { kind: 'signed'; revision?: string }
  | { kind: 'read-only'; revision?: string }

/** The revision an address pins the page to, as the header names it. */
export function revisionOf(href: string): string | undefined {
  const query = href.split('#')[0]?.split('?')[1]
  if (!query) return undefined
  const params = new URLSearchParams(query)
  const value =
    params.get('snapshot') ?? params.get('version') ?? params.get('revision')
  if (!value) return undefined
  return value.length > 14 ? `${value.slice(0, 8)}…` : value
}

/**
 * What the scientist may do in a pane. Exactly one pane is primary: it edits
 * (or reviews, on a review page). Every other pane is read-only and says which
 * revision it shows. Signed evidence is its own mode, whichever pane it is in.
 */
const EDITABLE_PAGE =
  /^\/(experiments\/(?!new(\/|$))|records\/|sheets\/|sheet-definitions\/)/

export function paneMode(
  href: string,
  primary: boolean,
  /** Whether the person may write here; a reader never sees "Editing". */
  canWrite = true,
  /** The record on show is frozen by an approved signature. */
  frozen = false,
): PaneMode {
  const path = href.split(/[?#]/)[0] ?? ''
  if (/^\/evidence\//.test(path)) return { kind: 'signed' }
  if (primary) {
    if (/^\/review\//.test(path)) return { kind: 'reviewing' }
    // Only pages with something to edit say so; Home and lists stay quiet.
    if (!EDITABLE_PAGE.test(path)) return { kind: 'plain' }
    if (frozen) return { kind: 'signed' }
    return canWrite
      ? { kind: 'editing' }
      : { kind: 'read-only', revision: revisionOf(href) }
  }
  // Home, lists and tools have nothing to edit, so "read-only" would be noise
  // there; it is only news on a page that could be edited, or a pinned revision.
  const revision = revisionOf(href)
  if (!EDITABLE_PAGE.test(path) && !revision) return { kind: 'plain' }
  return { kind: 'read-only', revision }
}

export function modeLabel(mode: PaneMode): string {
  switch (mode.kind) {
    case 'editing':
      return t('projects.workspaceState.editing')
    case 'plain':
      return ''
    case 'reviewing':
      return t('projects.workspaceState.reviewing')
    case 'signed':
      return mode.revision
        ? t('projects.workspaceState.signedAt', { revision: mode.revision })
        : t('projects.workspaceState.signed')
    case 'read-only':
      return mode.revision
        ? t('projects.workspaceState.readOnlyAt', {
            revision: mode.revision,
          })
        : t('projects.workspaceState.readOnly')
  }
}

export function newPane(
  href: string,
  id: string = crypto.randomUUID(),
): WorkspacePane {
  return { id, href, title: pageTitle(href), trail: [], forward: [] }
}

export function newTab(
  href: string,
  options: { id?: string; name?: string; paneId?: string } = {},
): WorkspaceTab {
  const pane = newPane(href, options.paneId ?? crypto.randomUUID())
  return {
    id: options.id ?? crypto.randomUUID(),
    name: options.name ?? t('projects.workspaceState.workspace'),
    panes: [pane],
    tree: leaf(pane.id),
    activeId: pane.id,
    primaryId: pane.id,
    links: [],
    dirty: false,
  }
}

export function initialWorkspace(href: string): WorkspaceState {
  const tab = newTab(href, {
    id: 'initial-tab',
    paneId: 'initial',
    name: t('projects.workspaceState.workspace'),
  })
  return {
    version: 2,
    tabs: [tab],
    activeTabId: tab.id,
    shelf: [],
    shelfOpen: false,
  }
}

const trailStep = z.object({
  href: z.string(),
  title: z.string(),
  identifier: z.string().optional(),
})

const savedPane = z.object({
  id: z.string().min(1),
  href: z.string(),
  title: z.string(),
  identifier: z.string().optional(),
  trail: z.array(trailStep).default([]),
  forward: z.array(trailStep).default([]),
})

const savedLink = z.object({
  letter: z.enum(['a', 'b', 'c']),
  driverId: z.string(),
  followerIds: z.array(z.string()),
})

const savedTab = z.object({
  id: z.string().min(1),
  name: z.string(),
  panes: z.array(savedPane),
  tree: z.unknown(),
  activeId: z.string(),
  primaryId: z.string(),
  links: z.array(savedLink).default([]),
  layoutId: z.string().optional(),
  dirty: z.boolean().default(false),
})

const savedWorkspace = z.object({
  version: z.literal(2),
  tabs: z.array(savedTab).min(1),
  activeTabId: z.string(),
  shelf: z
    .array(
      z.object({
        id: z.string(),
        href: z.string(),
        title: z.string(),
        identifier: z.string().optional(),
        from: z.string().optional(),
      }),
    )
    .default([]),
  shelfOpen: z.boolean().default(false),
})

function validTab(
  tab: z.infer<typeof savedTab>,
  origin: string,
): WorkspaceTab | null {
  const ids = tab.panes.map((pane) => pane.id)
  if (
    !tab.panes.length ||
    new Set(ids).size !== ids.length ||
    !ids.includes(tab.activeId) ||
    !ids.includes(tab.primaryId) ||
    !tab.panes.every(
      (pane) => workspaceHref(pane.href, origin) === pane.href,
    ) ||
    !isPaneTree(tab.tree)
  )
    return null
  const placed = listPaneIds(tab.tree)
  if (
    placed.length !== ids.length ||
    new Set(placed).size !== ids.length ||
    placed.some((id) => !ids.includes(id))
  )
    return null
  const links = tab.links.filter(
    (link) =>
      ids.includes(link.driverId) &&
      link.followerIds.length > 0 &&
      link.followerIds.every((id) => ids.includes(id) && id !== link.driverId),
  )
  return { ...tab, tree: tab.tree, links }
}

/** Persist destinations/layout only, never scientific data or unsaved drafts. */
export function restoreWorkspace(
  saved: string | null,
  href: string,
  origin: string,
): WorkspaceState {
  if (!saved) return initialWorkspace(href)
  try {
    const parsed = savedWorkspace.safeParse(JSON.parse(saved))
    if (!parsed.success) return initialWorkspace(href)
    const tabs = parsed.data.tabs.map((tab) => validTab(tab, origin))
    if (tabs.some((tab) => tab === null)) return initialWorkspace(href)
    const valid = tabs as WorkspaceTab[]
    if (new Set(valid.map((tab) => tab.id)).size !== valid.length)
      return initialWorkspace(href)
    const active = valid.find((tab) => tab.id === parsed.data.activeTabId)
    if (!active) return initialWorkspace(href)
    // The address bar remains authoritative for the focused page on reload.
    const restoredTabs = valid.map((tab) =>
      tab.id === active.id
        ? {
            ...tab,
            panes: tab.panes.map((pane) =>
              pane.id === tab.activeId
                ? {
                    ...pane,
                    href,
                    title: pageTitle(href),
                    identifier: undefined,
                  }
                : pane,
            ),
          }
        : tab,
    )
    return {
      version: 2,
      tabs: restoredTabs,
      activeTabId: active.id,
      shelf: parsed.data.shelf.filter(
        (item) => workspaceHref(item.href, origin) === item.href,
      ),
      shelfOpen: parsed.data.shelfOpen,
    }
  } catch {
    return initialWorkspace(href)
  }
}

/** A saved layout keeps destinations and arrangement, never history or data. */
export interface SavedLayout {
  id: string
  name: string
  panes: { id: string; href: string; title: string }[]
  tree: PaneTree
  primaryId: string
  savedAt: string
}

const layoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  panes: z.array(
    z.object({ id: z.string(), href: z.string(), title: z.string() }),
  ),
  tree: z.unknown(),
  primaryId: z.string(),
  savedAt: z.string(),
})

export function restoreSavedLayouts(
  saved: string | null,
  origin: string,
): SavedLayout[] {
  if (!saved) return []
  try {
    const parsed = z.array(layoutSchema).safeParse(JSON.parse(saved))
    if (!parsed.success) return []
    return parsed.data.flatMap((layout) => {
      const ids = layout.panes.map((pane) => pane.id)
      if (
        !layout.panes.length ||
        new Set(ids).size !== ids.length ||
        !ids.includes(layout.primaryId) ||
        !layout.panes.every(
          (pane) => workspaceHref(pane.href, origin) === pane.href,
        ) ||
        !isPaneTree(layout.tree) ||
        listPaneIds(layout.tree).some((id) => !ids.includes(id)) ||
        ids.some((id) => !hasPane(layout.tree as PaneTree, id))
      )
        return []
      return [{ ...layout, tree: layout.tree }]
    })
  } catch {
    return []
  }
}

export function layoutFromTab(
  tab: WorkspaceTab,
  id: string,
  name: string,
): SavedLayout {
  return {
    id,
    name,
    panes: tab.panes.map((pane) => ({
      id: pane.id,
      href: pane.href,
      title: pane.title,
    })),
    tree: tab.tree,
    primaryId: tab.primaryId,
    savedAt: new Date().toISOString(),
  }
}

/** Open a saved layout as a tab. New pane ids keep two copies independent. */
export function tabFromLayout(layout: SavedLayout): WorkspaceTab {
  const mapping = new Map(
    layout.panes.map((pane) => [pane.id, crypto.randomUUID()] as const),
  )
  const rename = (tree: PaneTree): PaneTree =>
    tree.type === 'pane'
      ? leaf(mapping.get(tree.id)!)
      : { ...tree, children: tree.children.map(rename) }
  const panes = layout.panes.map((pane) => ({
    id: mapping.get(pane.id)!,
    href: pane.href,
    title: pane.title,
    trail: [],
    forward: [],
  }))
  const primaryId = mapping.get(layout.primaryId)!
  return {
    id: crypto.randomUUID(),
    name: layout.name,
    panes,
    tree: rename(layout.tree),
    activeId: primaryId,
    primaryId,
    links: [],
    layoutId: layout.id,
    dirty: false,
  }
}

/** Tile a tab's panes into a preset, keeping every pane and its link groups. */
export function arrangeTab(
  tab: WorkspaceTab,
  preset: Exclude<LayoutPreset, 'single'>,
): WorkspaceTab {
  const ids = tab.panes.map((pane) => pane.id)
  const ordered = [tab.primaryId, ...ids.filter((id) => id !== tab.primaryId)]
  const byTree = listPaneIds(tab.tree)
  // Keep reading order stable; only the primary comes first for primary+context.
  const order = preset === 'primary-context' ? ordered : byTree
  return {
    ...tab,
    tree: applyPreset(preset, order, tab.primaryId),
    dirty: true,
  }
}
