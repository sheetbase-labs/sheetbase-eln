import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  Inspector,
  InspectorSection,
  Muted,
  Section, DescriptionList 
} from '#/components/v3/ui/layout'
import {
  fetchBlocksForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import {
  experimentStatusFor,
  useExperimentLinks,
  useExperimentRecord,
} from '../$expId'

/** UI port (roadmap-4/ui-app3): the experiment Overview. Reads the record's
 * notes; protocol progress, key results and readiness are capabilities the ELN
 * does not have yet, so they state the gap. */
export const Route = createFileRoute('/experiments/$expId/overview')({
  component: Overview,
})

interface DocNode {
  type?: string
  content?: DocNode[]
  text?: string
}
interface Doc {
  content?: DocNode[]
}

function textOf(node: DocNode): string {
  if (node.text) return node.text
  return (node.content ?? []).map(textOf).join('')
}

function sectionsFromBlocks(
  blocks: { id: string; payload: Record<string, unknown> }[],
): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = []
  for (const block of blocks) {
    const doc = (block.payload as { doc?: Doc }).doc
    if (!doc?.content) continue
    let heading = ''
    const parts: string[] = []
    for (const node of doc.content) {
      if (node.type === 'heading') heading = textOf(node)
      else parts.push(textOf(node))
    }
    if (heading || parts.length) {
      out.push({ heading: heading || 'Notes', body: parts.join('\n').trim() })
    }
  }
  return out
}

function Overview() {
  const { expId } = Route.useParams()
  const { data: record } = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)
  const blocks = useQuery({
    queryKey: notebookQueryKeys.blocks(expId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, expId),
  })
  const sections = sectionsFromBlocks(blocks.data ?? [])
  const rows = links.data ?? []

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-4 py-5 md:px-8">
        {sections.length ? (
          sections.map((s) => (
            <Section key={s.heading + s.body.slice(0, 12)} title={s.heading}>
              <p className="m-0 max-w-[680px] whitespace-pre-line text-prose">
                {s.body || '—'}
              </p>
            </Section>
          ))
        ) : (
          <Section title="Objective">
            <Muted>
              {blocks.isLoading
                ? 'Loading notes…'
                : 'This experiment has no notes yet.'}
            </Muted>
          </Section>
        )}

        <Section title="Protocol progress">
          <Muted>
            Protocol versions and step progress are not built yet; the
            experiment stores no protocol version.
          </Muted>
        </Section>
      </div>

      <Inspector className="w-[300px]">
        <InspectorSection title="Key results">
          <Muted>Preliminary results arrive with the results capability.</Muted>
        </InspectorSection>
        <InspectorSection title="Details">
          <DescriptionList
            labelWidth={110}
            items={[
              [
                'Identifier',
                <span className="mono">{record?.identifier ?? '—'}</span>,
              ],
              [
                'Status',
                record ? experimentStatusFor(record.status).label : '—',
              ],
              [
                'Samples',
                String(rows.filter((l) => l.target_kind === 'sample').length),
              ],
              [
                'Datasets',
                String(rows.filter((l) => l.target_kind === 'dataset').length),
              ],
              [
                'Files',
                String(rows.filter((l) => l.target_kind === 'file').length),
              ],
            ]}
          />
        </InspectorSection>
      </Inspector>
    </>
  )
}
