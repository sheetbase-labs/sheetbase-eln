import { z } from 'zod'

import { t } from '#/copy'
import { BLOCK_PICKER_OPTIONS } from '#/lib/blocks/registry'
import type { BlockPickerOption } from '#/lib/blocks/registry'

/** Menu-only commands are not persisted block catalogue entries. */
export const AI_SLASH_TYPE = 'ai'
export const AI_GROUP_ID = 'ai'
export const PLUGIN_GROUP_ID = 'plugins'
export const COMMON_GROUP_ID = 'common'
export const RECENT_GROUP_ID = 'recent'

/** Once something is typed, matches sit in one list, best match first. */
export const MATCH_GROUP_ID = 'matches'

/** Menu-only: turns the current paragraph into a heading, in place. */
export const HEADING_SLASH_TYPE = 'heading'

/** The four blocks nearly every entry starts with, shown first and in this order. */
const COMMON_TYPES: readonly string[] = [
  'rich_text',
  HEADING_SLASH_TYPE,
  'checklist',
  'sheet',
]

const COMMON_RANK = new Map(COMMON_TYPES.map((type, at) => [type, at]))

const RECENT_KEY = 'sheetbase.slashMenu.recent'
const RECENT_SHOWN = 3

export type SlashCommandOption = Omit<BlockPickerOption, 'group'> & {
  group:
    | BlockPickerOption['group']
    | typeof AI_GROUP_ID
    | typeof PLUGIN_GROUP_ID
    | typeof COMMON_GROUP_ID
    | typeof RECENT_GROUP_ID
    | typeof MATCH_GROUP_ID
}

const HEADING_OPTION: SlashCommandOption = {
  type: HEADING_SLASH_TYPE,
  label: t('notebook.slashCommandMenu.headingLabel'),
  description: t('notebook.slashCommandMenu.headingDescription'),
  icon: 'heading2',
  group: 'writing',
  aliases: ['title', 'section', 'h2', 'h1', 'subheading'],
}

/** Block types picked lately on this device, newest first. */
export function recentSlashTypes(): string[] {
  try {
    return z
      .array(z.string())
      .catch([])
      .parse(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'))
  } catch {
    return []
  }
}

/** Remember a pick so it floats to the top of the menu next time. */
export function recordSlashUse(type: string): void {
  if (type === AI_SLASH_TYPE || COMMON_TYPES.includes(type)) return

  try {
    const next = [type, ...recentSlashTypes().filter((x) => x !== type)]
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 8)))
  } catch {
    // Storage can be blocked; the menu just has no recents then.
  }
}

const GROUP_ORDER: readonly string[] = [
  AI_GROUP_ID,
  COMMON_GROUP_ID,
  RECENT_GROUP_ID,
  MATCH_GROUP_ID,
  'structure',
  'writing',
  'evidence',
  'sign',
  PLUGIN_GROUP_ID,
]

const AI_OPTION: SlashCommandOption = {
  type: AI_SLASH_TYPE,
  label: t('notebook.aiComposer.slashLabel'),
  description: t('notebook.aiComposer.slashDescription'),
  icon: 'spark',
  group: AI_GROUP_ID,
  aliases: [
    'ai',
    'write',
    'draft',
    'rewrite',
    'summarise',
    'summarize',
    'conclusion',
  ],
}

function optionMatches(opt: SlashCommandOption, query: string): boolean {
  const q = query.toLowerCase().trim()

  if (!q) return true

  return (
    opt.label.toLowerCase().includes(q) ||
    opt.type.toLowerCase().includes(q) ||
    opt.description.toLowerCase().includes(q) ||
    opt.aliases.some((alias) => alias.toLowerCase().includes(q))
  )
}

/** Filter both the menu and the editor's keyboard choices by the same query. */
export function slashCommandFilteredOptions(
  query: string,
  withAi = false,
  pluginOptions: readonly SlashCommandOption[] = [],
) {
  const all: SlashCommandOption[] = [
    ...(withAi ? [AI_OPTION] : []),
    ...BLOCK_PICKER_OPTIONS,
    HEADING_OPTION,
    ...pluginOptions,
  ]

  const browsing = !query.trim()
  const recent = browsing ? recentSlashTypes().slice(0, RECENT_SHOWN) : []
  const recentRank = new Map(recent.map((type, at) => [type, at]))

  // With nothing typed, the common blocks lead and recent picks follow; once
  // the person types, the groups step aside and only matches show.
  const placed = all.map((opt): SlashCommandOption => {
    if (!browsing) return { ...opt, group: MATCH_GROUP_ID }

    if (COMMON_RANK.has(opt.type)) return { ...opt, group: COMMON_GROUP_ID }

    if (recentRank.has(opt.type)) return { ...opt, group: RECENT_GROUP_ID }

    return opt
  })

  const rank = (opt: SlashCommandOption) => {
    const group = GROUP_ORDER.indexOf(opt.group)

    if (opt.group === COMMON_GROUP_ID) {
      return group * 100 + (COMMON_RANK.get(opt.type) ?? 0)
    }

    if (opt.group === RECENT_GROUP_ID) {
      return group * 100 + (recentRank.get(opt.type) ?? 0)
    }

    if (opt.group === MATCH_GROUP_ID) {
      const q = query.toLowerCase().trim()
      const label = opt.label.toLowerCase()

      // A label that starts with what was typed beats one that merely holds
      // it, which beats a match on an alias or the description.
      return group * 100 + (label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2)
    }

    return group * 100
  }

  return placed
    .flatMap((opt, index) =>
      optionMatches(opt, query) ? [{ opt, index }] : [],
    )
    .sort((a, b) => rank(a.opt) - rank(b.opt) || a.index - b.index)
    .map(({ opt }) => opt)
}

/** The slash-menu entries for the blocks installed plugins add. */
export function pluginSlashOptions(
  blocks: readonly {
    extensionKey: string
    extensionName: string
    id: string
    declaration: { title: string; description?: string }
  }[],
  prefix: string,
): SlashCommandOption[] {
  return blocks.map((item) => ({
    type: `${prefix}${item.extensionKey}/${item.id}`,
    label: item.declaration.title,
    description:
      item.declaration.description ??
      t('plugins.screen.from', { plugin: item.extensionName }),
    icon: 'puzzle',
    group: PLUGIN_GROUP_ID,
    aliases: [item.extensionName],
  }))
}

/** The parent uses the same filtered count to clamp its keyboard selection. */
export function slashCommandFilterCount(
  query: string,
  withAi = false,
  pluginOptions: readonly SlashCommandOption[] = [],
): number {
  return slashCommandFilteredOptions(query, withAi, pluginOptions).length
}
