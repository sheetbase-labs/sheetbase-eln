import { Muted, Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type { ExtensionInstrumentParserDeclaration } from '#/lib/extensions/data-points'
import { t } from '#/copy'

type PluginParser = RunnerItem<ExtensionInstrumentParserDeclaration>

/**
 * Instrument parsers that installed plugins add. They read an instrument's own
 * file during an import; they are not versioned or approved here, because the
 * plugin is what an administrator installed and switched on.
 */
export function PluginParserTable() {
  const parsers = useExtensionPoints().data['instrument-parsers']
  return <PluginParserList parsers={parsers} />
}

export function PluginParserList({ parsers }: { parsers: PluginParser[] }) {
  if (parsers.length === 0) return null
  const columns: RegistryColumn<PluginParser>[] = [
    {
      id: 'parser',
      header: t('plugins.parsers.parser'),
      cell: ({ row }) => (
        <span title={row.original.declaration.description}>
          {row.original.declaration.title}
        </span>
      ),
    },
    {
      id: 'instrument',
      header: t('plugins.parsers.instrument'),
      cell: ({ row }) =>
        row.original.declaration.instrument ?? (
          <span className="text-fg-muted">{t('common.states.none')}</span>
        ),
    },
    {
      id: 'reads',
      header: t('plugins.parsers.reads'),
      cell: ({ row }) => row.original.declaration.extensions.join(', '),
    },
    {
      id: 'recognised',
      header: t('plugins.parsers.recognisedBy'),
      cell: ({ row }) => {
        const contains = row.original.declaration.contains
        return contains ? (
          <span className="block max-w-56 truncate" title={contains.join(', ')}>
            {t('plugins.parsers.carries', { text: contains.join(', ') })}
          </span>
        ) : (
          <span className="text-fg-muted">
            {t('plugins.parsers.byExtension')}
          </span>
        )
      },
    },
    {
      id: 'plugin',
      header: t('plugins.parsers.from'),
      cell: ({ row }) => row.original.extensionName,
    },
  ]
  return (
    <Section title={t('plugins.parsers.title')}>
      <Muted>{t('plugins.parsers.hint')}</Muted>
      <TableBox>
        <RegistryGrid
          label={t('plugins.parsers.title')}
          rows={parsers}
          columns={columns}
          getRowId={(parser) => parser.name}
          selectable={false}
        />
      </TableBox>
    </Section>
  )
}
