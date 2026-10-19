import type { IconName } from '#/components/v3/icons'
import { primaryNav, recordNav } from '#/components/v3/shell/nav'
import { createContextFromPath } from '#/components/v3/shell/create-context'
import { filterNavForRole } from '#/lib/nav-visibility'

/**
 * The palette's commands: places to go and things to create. They sit beside
 * the search results so one keystroke reaches any page or create screen
 * without the pointer, and they hand over what the page behind the palette is
 * about the way the New menu does.
 */
export interface PaletteCommand {
  id: string
  group: 'Go to' | 'New'
  label: string
  icon: IconName
  /** Route path without a query string. */
  to: string
  search?: Record<string, string | boolean>
}

const EXTRA_PLACES: { label: string; icon: IconName; to: string }[] = [
  { label: 'Settings', icon: 'settings', to: '/settings' },
  { label: 'Help', icon: 'info', to: '/help' },
]

/** Every page the person's role can open, in the navigation's own order. */
export function goToCommands(
  role: string | null | undefined,
): PaletteCommand[] {
  const places = [
    ...filterNavForRole([...primaryNav, ...recordNav], role).map((item) => ({
      label: item.label,
      icon: item.icon,
      to: String(item.link.to),
    })),
    ...EXTRA_PLACES,
  ]
  return places.map((place) => ({
    id: `go-${place.to}`,
    group: 'Go to',
    ...place,
  }))
}

/** The create screens, carrying the project, sample or dataset in view. */
export function newCommands(pathname: string | undefined): PaletteCommand[] {
  const context = createContextFromPath(pathname ?? '')
  return [
    {
      id: 'new-experiment',
      group: 'New',
      label: 'New experiment',
      icon: 'flask',
      to: '/experiments/new',
      search: {
        ...(context.project ? { project: context.project } : {}),
        ...(context.sample ? { sample: context.sample } : {}),
      },
    },
    {
      id: 'new-sample',
      group: 'New',
      label: 'New sample',
      icon: 'tube',
      to: '/samples',
      search: { new: true },
    },
    {
      id: 'new-project',
      group: 'New',
      label: 'New project',
      icon: 'folder',
      to: '/projects',
      search: { new: true },
    },
    {
      id: 'new-sheet',
      group: 'New',
      label: 'New working sheet',
      icon: 'table',
      to: '/sheets/new',
    },
    {
      id: 'new-analysis',
      group: 'New',
      label: 'New analysis',
      icon: 'chart',
      to: '/analysis/new',
      search: context.dataset ? { dataset: context.dataset } : undefined,
    },
    {
      id: 'new-import',
      group: 'New',
      label: 'Import data',
      icon: 'upload',
      to: '/import',
      search: {
        ...(context.experiment ? { experiment: context.experiment } : {}),
        ...(context.dataset ? { dataset: context.dataset } : {}),
      },
    },
  ]
}

const COMMAND_PREFIX = /^(go to|goto|go|open|new|create)\s+/i

/**
 * The query as a command search: a leading verb ("go to", "new") names the
 * group it asks for and is not part of the label being matched.
 */
export function parseCommandQuery(query: string): {
  group: PaletteCommand['group'] | null
  text: string
} {
  const trimmed = query.trim()
  const verb = COMMAND_PREFIX.exec(trimmed)
  if (!verb) return { group: null, text: trimmed.toLowerCase() }
  const word = verb[1].toLowerCase()
  return {
    group: word === 'new' || word === 'create' ? 'New' : 'Go to',
    text: trimmed.slice(verb[0].length).trim().toLowerCase(),
  }
}

/**
 * The commands a query asks for. An empty query lists them all; a bare verb
 * ("new") lists its group; otherwise a command matches when its label contains
 * the text (the "New " in "New sample" is not held against "sample").
 */
export function matchCommands(
  commands: PaletteCommand[],
  query: string,
): { commands: PaletteCommand[]; leads: boolean } {
  const { group, text } = parseCommandQuery(query)
  const verbOnly = /^(go to|goto|go|open|new|create)$/i.test(query.trim())
  if (!query.trim() || verbOnly) {
    const wanted = verbOnly
      ? parseCommandQuery(`${query.trim()} x`).group
      : null
    return {
      commands: wanted ? commands.filter((c) => c.group === wanted) : commands,
      leads: true,
    }
  }
  const matched = commands.filter((command) => {
    if (group && command.group !== group) return false
    const label = command.label.toLowerCase().replace(/^new\s+/, '')
    return label.includes(text) || command.label.toLowerCase().includes(text)
  })
  return { commands: matched, leads: group !== null }
}
