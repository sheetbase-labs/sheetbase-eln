import { formatNotebookDateTime } from '#/lib/notebook-data'
import { sentenceCase } from '#/lib/sentence-case'
import { Button } from '#/components/v3/ui/button'
import { Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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
            <TableHead>{t('settings.parserVersions.parser')}</TableHead>
            <TableHead>{t('settings.parserVersions.revision')}</TableHead>
            <TableHead>{t('settings.parserVersions.instrument')}</TableHead>
            <TableHead>{t('settings.parserVersions.kind')}</TableHead>
            <TableHead>{t('settings.parserVersions.format')}</TableHead>
            <TableHead>{t('settings.parserVersions.status')}</TableHead>
            <TableHead>{t('settings.parserVersions.validation')}</TableHead>
            <TableHead>{t('settings.parserVersions.approval')}</TableHead>
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
