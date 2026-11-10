import { t } from '#/copy'
import { BLOCK_PICKER_OPTIONS } from '#/lib/blocks/registry'
import type { BlockPickerOption } from '#/lib/blocks/registry'

/** Menu-only commands are not persisted block catalogue entries. */
export const AI_SLASH_TYPE = 'ai'
export const AI_GROUP_ID = 'ai'
export const PLUGIN_GROUP_ID = 'plugins'

export type SlashCommandOption = Omit<BlockPickerOption, 'group'> & {
  group:
    BlockPickerOption['group'] | typeof AI_GROUP_ID | typeof PLUGIN_GROUP_ID
}

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
  const options = [
    ...(withAi ? [AI_OPTION] : []),
    ...BLOCK_PICKER_OPTIONS,
    ...pluginOptions,
  ]

  return options.filter((opt) => optionMatches(opt, query))
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
