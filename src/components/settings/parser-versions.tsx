import { formatNotebookDateTime } from '#/lib/notebook-data'
import { sentenceCase } from '#/lib/sentence-case'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { parserKindOf } from '#/lib/connectors/builtin-parsers'
import type {
  ParserSettingsRow,
  ParserSettingsVersion,
} from '#/lib/parser-settings'
import { t } from '#/copy'

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

  return (
    <TableBox>
      <Table aria-label={t('settings.parserVersions.parserVersionsAria')}>
        <TableHeader>
          <TableRow>
            {[
              t('settings.parserVersions.parser'),
              t('settings.parserVersions.revision'),
              t('settings.parserVersions.instrument'),
              t('settings.parserVersions.kind'),
              t('settings.parserVersions.format'),
              t('settings.parserVersions.status'),
              t('settings.parserVersions.validation'),
              t('settings.parserVersions.approval'),
            ].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {parsers.flatMap((parser) =>
            parser.parser_versions.map((version) => (
              <TableRow
                key={version.id}
                selected={version.id === selectedVersionId}
              >
                <TableCell>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onSelect(parser, version)}
                    aria-pressed={version.id === selectedVersionId}
                  >
                    {parser.name}
                  </Button>
                </TableCell>
                <TableCell>{version.version}</TableCell>
                <TableCell>
                  {parser.instruments?.name ??
                    t('settings.parserVersions.linked')}
                </TableCell>
                <TableCell>
                  {t(
                    `settings.parserVersions.kinds.${parserKindOf(parser.key, version.signature)}`,
                  )}
                </TableCell>
                <TableCell>{parser.format.toUpperCase()}</TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell title={version.validated_at ?? undefined}>
                  {version.validated_at ? (
                    <time dateTime={version.validated_at}>
                      {formatNotebookDateTime(version.validated_at, {
                        zone: true,
                      })}
                    </time>
                  ) : (
                    t('settings.parserVersions.tested')
                  )}
                </TableCell>
                <TableCell
                  title={
                    version.approved_at
                      ? `${version.approved_at} · ${version.approved_by_user_id}`
                      : undefined
                  }
                >
                  {version.approved_at ? (
                    <time dateTime={version.approved_at}>
                      {formatNotebookDateTime(version.approved_at, {
                        zone: true,
                      })}
                    </time>
                  ) : (
                    t('settings.parserVersions.approved')
                  )}
                </TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </TableBox>
  )
}
