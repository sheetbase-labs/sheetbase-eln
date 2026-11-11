import { formatNotebookDateTime } from '#/lib/notebook-data'
import { sentenceCase } from '#/lib/sentence-case'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { parserKindOf } from '#/lib/connectors/builtin-parsers'
import type {
  ParserSettingsRow,
  ParserSettingsVersion,
} from '#/lib/parser-settings'
import { t } from '#/copy'

interface VersionLine {
  id: string
  parser: ParserSettingsRow
  version: ParserSettingsVersion
}

/** Uses persisted version state, never the build-time recognition catalogue. */
export function ParserVersions({
  parsers,
  selectedVersionId,
  onSelect,
}: {
  parsers: ParserSettingsRow[]
  selectedVersionId: string | null
  onSelect: (parser: ParserSettingsRow, version: ParserSettingsVersion) => void
}) {
  if (!parsers.some((parser) => parser.parser_versions.length)) {
    return <Muted>{t('settings.parserVersions.parserVersionsCreated')}</Muted>
  }

  const rows: VersionLine[] = parsers.flatMap((parser) =>
    parser.parser_versions.map((version) => ({
      id: version.id,
      parser,
      version,
    })),
  )

  const columns: RegistryColumn<VersionLine>[] = [
    {
      id: 'parser',
      header: t('settings.parserVersions.parser'),
      accessorFn: ({ parser }) => parser.name,
      cell: ({ row }) => {
        const { parser, version } = row.original

        return (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => onSelect(parser, version)}
            aria-pressed={version.id === selectedVersionId}
          >
            {parser.name}
          </Button>
        )
      },
    },
    {
      id: 'revision',
      header: t('settings.parserVersions.revision'),
      accessorFn: ({ version }) => version.version,
    },
    {
      id: 'instrument',
      header: t('settings.parserVersions.instrument'),
      accessorFn: ({ parser }) =>
        parser.instruments?.name ?? t('settings.parserVersions.linked'),
    },
    {
      id: 'kind',
      header: t('settings.parserVersions.kind'),
      accessorFn: ({ parser, version }) =>
        t(
          `settings.parserVersions.kinds.${parserKindOf(parser.key, version.signature)}`,
        ),
    },
    {
      id: 'format',
      header: t('settings.parserVersions.format'),
      accessorFn: ({ parser }) => parser.format.toUpperCase(),
    },
    {
      id: 'status',
      header: t('settings.parserVersions.status'),
      accessorFn: ({ version }) => sentenceCase(version.status),
      cell: ({ row }) => {
        const { version } = row.original

        return (
          <Status
            tone={
              version.status === 'approved'
                ? 'ok'
                : version.status === 'validated'
                  ? 'review'
                  : version.status === 'retired'
                    ? 'stored'
                    : 'draft'
            }
          >
            {sentenceCase(version.status)}
          </Status>
        )
      },
    },
    {
      id: 'validation',
      header: t('settings.parserVersions.validation'),
      accessorFn: ({ version }) => version.validated_at ?? '',
      cell: ({ row }) => {
        const { version } = row.original

        return version.validated_at ? (
          <time dateTime={version.validated_at} title={version.validated_at}>
            {formatNotebookDateTime(version.validated_at, { zone: true })}
          </time>
        ) : (
          t('settings.parserVersions.tested')
        )
      },
    },
    {
      id: 'approval',
      header: t('settings.parserVersions.approval'),
      accessorFn: ({ version }) => version.approved_at ?? '',
      cell: ({ row }) => {
        const { version } = row.original

        return version.approved_at ? (
          <time
            dateTime={version.approved_at}
            title={`${version.approved_at} · ${version.approved_by_user_id}`}
          >
            {formatNotebookDateTime(version.approved_at, { zone: true })}
          </time>
        ) : (
          t('settings.parserVersions.approved')
        )
      },
    },
  ]

  return (
    <TableBox>
      <RegistryGrid
        label={t('settings.parserVersions.parserVersionsAria')}
        rows={rows}
        columns={columns}
        getRowId={(line) => line.id}
        rowSelection={selectedVersionId ? { [selectedVersionId]: true } : {}}
        onRowClick={(line) => onSelect(line.parser, line.version)}
      />
    </TableBox>
  )
}
