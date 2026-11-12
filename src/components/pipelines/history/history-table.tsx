import { Button } from '#/components/ui/button'
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
import { words } from '#/lib/pipelines/simple/words'
import { formatDate } from '#/lib/format-date'
import { PIPELINE_MODES } from '#/lib/pipelines/config'
import type { PipelineMode } from '#/lib/pipelines/config'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

const hs = words('history')

/** The mode a stored version was written in; versions from before modes were Standard. */
export function versionMode(
  version: PipelineDefinitionVersionWire,
): PipelineMode {
  const mode: unknown = version.configuration.mode

  return PIPELINE_MODES.find((m) => m === mode) ?? 'standard'
}

const LIFECYCLE = {
  draft: { tone: 'draft', label: 'draft' },
  published: { tone: 'ok', label: 'published' },
  retired: { tone: 'stored', label: 'retired' },
} as const

/**
 * Every version of a pipeline, each with the mode it was written in. Older
 * versions open read-only as they were; Duplicate… makes a new pipeline from one.
 */
export function HistoryTable({
  versions,
  names,
  convertedVersion,
  onOpen,
  onDuplicate,
}: {
  versions: PipelineDefinitionVersionWire[]
  /** User id to name, for who made each version. */
  names: Record<string, string>
  /** The version that was written by converting, with who and when. */
  convertedVersion: Set<string>
  onOpen: (version: PipelineDefinitionVersionWire) => void
  onDuplicate: (version: PipelineDefinitionVersionWire) => void
}) {
  return (
    <TableBox>
      <Table caption={hs('aria')}>
        <TableHeader>
          <TableRow>
            <TableHead>{hs('version')}</TableHead>
            <TableHead>{hs('mode')}</TableHead>
            <TableHead>{hs('state')}</TableHead>
            <TableHead>{hs('made')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody empty={hs('none')} colSpan={5}>
          {versions.map((version) => {
            const lifecycle = LIFECYCLE[version.lifecycle]

            const who = version.created_by_user_id
              ? names[version.created_by_user_id]
              : undefined

            return (
              <TableRow key={version.id}>
                <TableCell className="font-medium">
                  v{version.version}
                </TableCell>
                <TableCell>{words('mode')(versionMode(version))}</TableCell>
                <TableCell>
                  <Status tone={lifecycle.tone}>{hs(lifecycle.label)}</Status>
                </TableCell>
                <TableCell className="text-fg-muted">
                  {convertedVersion.has(version.id)
                    ? `${hs('convertedBy')} · `
                    : ''}
                  {who ? `${who} · ` : ''}
                  {version.lifecycle === 'published' && version.published_at
                    ? hs('publishedAt', {
                        date: formatDate(version.published_at),
                      })
                    : version.lifecycle === 'retired' && version.retired_at
                      ? hs('retiredAt', {
                          date: formatDate(version.retired_at),
                        })
                      : formatDate(version.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex gap-1.5">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => onOpen(version)}
                    >
                      {hs('open')}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => onDuplicate(version)}
                    >
                      {hs('duplicate')}
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableBox>
  )
}
