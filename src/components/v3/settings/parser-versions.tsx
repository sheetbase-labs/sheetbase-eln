import { formatNotebookDateTime } from '#/lib/notebook-data'
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
import type {
  ParserSettingsRow,
  ParserSettingsVersion,
} from '#/lib/parser-settings'

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
    return (
      <Muted>No parser versions have been created in this workspace.</Muted>
    )
  }
  return (
    <TableBox>
      <Table aria-label="Parser versions">
        <TableHeader>
          <TableRow>
            <TableHead>Parser version</TableHead>
            <TableHead>Instrument</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Validation</TableHead>
            <TableHead>Approval</TableHead>
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
                    {parser.name} v{version.version}
                  </Button>
                </TableCell>
                <TableCell>
                  {parser.instruments?.name ?? 'Not linked'}
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
                    {version.status}
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
                    'Not tested'
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
                    'Not approved'
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
