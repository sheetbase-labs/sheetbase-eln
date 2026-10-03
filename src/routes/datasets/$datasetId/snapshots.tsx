import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { stickyCell, stickyHead } from '#/components/v3/inventory/list'
import {
  countSnapshotCitations,
  describeRetentionPolicy,
  describeSnapshotRetention,
  describeSnapshotSource,
} from '#/components/v3/datasets/snapshot-data'
import type { SnapshotVersion } from '#/components/v3/datasets/snapshot-data'
import { cn } from '#/lib/utils'
import { useDatasetVersions } from '../$datasetId'

/** UI port (roadmap-4/ui-app3): the dataset Snapshots tab, wired to
 * dataset_version_list. DSET-03.1: retention, producer, hash and cited-by are
 * read from the model rather than hardcoded. */
export const Route = createFileRoute('/datasets/$datasetId/snapshots')({
  component: Snapshots,
})

function Snapshots() {
  const { datasetId } = Route.useParams()
  const versions = useDatasetVersions(datasetId)
  const rows = (versions.data ?? []) as unknown as SnapshotVersion[]
  const [selected, setSelected] = useState<string | null>(null)
  const current = rows.find((v) => v.id === selected) ?? rows.at(0)
  const index = current ? rows.indexOf(current) : -1
  const previous = index >= 0 ? rows[index + 1] : undefined
  const retention = describeSnapshotRetention(current?.retention)
  const citations = countSnapshotCitations(current?.citedBy)
  const citedCount =
    citations.signedRevisions + citations.pipelineRuns + citations.analyses

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
        <Notice icon="lock">
          A snapshot never changes. Records, analyses and pipeline runs cite the
          snapshot they used, so later imports can’t alter what was reviewed.
        </Notice>
        {rows.length ? (
          <TableBox>
            <Table className="max-lg:min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead className={stickyHead}>Snapshot</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead align="right">Rows</TableHead>
                  <TableHead>Source revision</TableHead>
                  <TableHead>Retention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => {
                  const view = describeSnapshotRetention(v.retention)
                  return (
                    <TableRow
                      key={v.id}
                      selected={v.id === current?.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(v.id)}
                    >
                      <TableCell
                        className={cn(
                          stickyCell,
                          v.id === current?.id && 'font-semibold',
                        )}
                      >
                        <span className="mono">{v.label}</span>
                      </TableCell>
                      <TableCell>
                        {v.createdAt.slice(0, 16).replace('T', ' ')}
                      </TableCell>
                      <TableCell align="right">{v.rowCount}</TableCell>
                      <TableCell className="num">
                        {v.sourceDatasetRevision}
                      </TableCell>
                      <TableCell>
                        <Status tone={view.tone}>{view.label}</Status>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Muted>
            {versions.isLoading
              ? 'Loading snapshots…'
              : 'No snapshots yet. Snapshot the dataset to freeze its rows as evidence.'}
          </Muted>
        )}
        <Muted>
          Imports and pipelines save snapshots automatically; you can also
          snapshot before an edit.
        </Muted>
      </div>

      {current ? (
        <Inspector className="w-[320px]">
          <InspectorSection title={`Snapshot ${current.label}`}>
            <DescriptionList
              labelWidth={96}
              items={[
                ['Saved', current.createdAt.slice(0, 16).replace('T', ' ')],
                ['Rows', String(current.rowCount)],
                ['Source revision', String(current.sourceDatasetRevision)],
                [
                  'Made by',
                  current.createdByName ??
                    current.createdByUserId ??
                    current.createdByCredentialId ??
                    '—',
                ],
                ['Source', describeSnapshotSource(current.source)],
                [
                  'Cited by',
                  citedCount === 0
                    ? 'Not cited'
                    : `${citations.signedRevisions} signed · ${citations.pipelineRuns} runs · ${citations.analyses} analyses`,
                ],
                ...(previous
                  ? ([['Previous', previous.label]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Content hash">
            <span className="mono break-all text-[11px] leading-[16px]">
              {current.contentHash}
            </span>
          </InspectorSection>
          <InspectorSection title="Keeping">
            <div className="flex flex-col gap-2">
              <Status tone={retention.tone}>{retention.label}</Status>
              <Muted>{retention.detail}</Muted>
              <Muted>{describeRetentionPolicy(current.retention)}</Muted>
            </div>
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
