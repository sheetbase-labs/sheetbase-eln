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
import { cn } from '#/lib/utils'
import { useDatasetVersions } from '../$datasetId'

/** UI port (roadmap-4/ui-app3): the dataset Snapshots tab, wired to
 * dataset_version_list. */
export const Route = createFileRoute('/datasets/$datasetId/snapshots')({
  component: Snapshots,
})

function Snapshots() {
  const { datasetId } = Route.useParams()
  const versions = useDatasetVersions(datasetId)
  const rows = versions.data ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const current = rows.find((v) => v.id === selected) ?? rows.at(0)
  const index = current ? rows.indexOf(current) : -1
  const previous = index >= 0 ? rows[index + 1] : undefined

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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => (
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
                      <Status tone="stored">Kept</Status>
                    </TableCell>
                  </TableRow>
                ))}
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
        <Inspector className="w-[300px]">
          <InspectorSection title={`Snapshot ${current.label}`}>
            <DescriptionList
              labelWidth={96}
              items={[
                ['Saved', current.createdAt.slice(0, 16).replace('T', ' ')],
                ['Rows', String(current.rowCount)],
                ['Source revision', String(current.sourceDatasetRevision)],
                ['Made by', current.createdByUserId ?? '—'],
                ...(previous
                  ? ([['Previous', previous.label]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Keeping">
            <Muted>
              Snapshots cited by a signed record are kept for 15 years. Others
              are kept for 2 years after the dataset is archived.
            </Muted>
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
