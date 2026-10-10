/**
 * EXP-02.4 — the experiment Overview per `canvas/ExpOverview.dc.html`.
 *
 * Composes the objective, protocol progress, "open before submission" (every
 * row deep-links to the notebook block that resolves it), key results and
 * properties, with linked experiments and signatures in the inspector.
 *
 * The component is presentational: the route supplies fetched facts. Where a
 * fact the design shows is not modelled (protocol step progress, reviewer,
 * planned end), the section names the gap rather than rendering a placeholder.
 */
import { Link } from '@tanstack/react-router'

import { SignaturesTable } from '#/components/review/signatures-table'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import type { SignatureWire } from '#/lib/signatures'
import { readinessItems } from './readiness'
import type {
  ExperimentReadiness,
  ReadinessBlock,
  ReadinessItem,
} from './readiness'

export interface OverviewExperimentRecord {
  id: string
  identifier: string
  title: string
  status: string
  projectId: string | null
  createdByUserId: string
  createdAt: string
  properties: Record<string, unknown>
}

export interface OverviewLinkedExperiment {
  id: string
  identifier: string
  title: string
  status: string | null
}

/** The link fields the overview renders, mapped from the wire row. */
export interface OverviewLink {
  id: string
  linkType: string
  targetKind: string
  targetIdentifier: string
  targetRecordId: string | null
}

export interface ExperimentOverviewProps {
  record: OverviewExperimentRecord
  blocks: readonly ReadinessBlock[]
  links: readonly OverviewLink[]
  readiness: ExperimentReadiness | null
  readinessIsLoading?: boolean
  readinessError?: string | null
  signatures: SignatureWire[]
  signaturesIsLoading?: boolean
  signaturesIsError?: boolean
  followedBy: readonly OverviewLinkedExperiment[]
  userLabel: (userId: string) => string
  projectName?: string | null
}

/** Plain text of every prose block, in document order. */
function objectiveText(blocks: readonly ReadinessBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    const text = blockDocText(block.payload)
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

function blockDocText(payload: Record<string, unknown>): string {
  if (!('doc' in payload)) return ''
  const doc = payload.doc
  if (!doc || typeof doc !== 'object' || !('content' in doc)) return ''
  const content = doc.content
  return Array.isArray(content) ? content.map(proseText).join('\n').trim() : ''
}

function proseText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const text = 'text' in node ? node.text : undefined
  if (typeof text === 'string') return text
  const content = 'content' in node ? node.content : undefined
  return Array.isArray(content) ? content.map(proseText).join('') : ''
}

/** Read an optional list-valued property without inventing a shape. */
function propertyIds(
  properties: Record<string, unknown>,
  key: string,
): string[] {
  const value = properties[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function propertyText(
  properties: Record<string, unknown>,
  key: string,
): string | null {
  const value = properties[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ReadinessRow({
  item,
  recordId,
}: {
  item: ReadinessItem
  recordId: string
}) {
  return (
    <li
      data-readiness-kind={item.kind}
      data-readiness-severity={item.severity}
      className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
    >
      <div className="min-w-0">
        <span
          className={item.severity === 'blocking' ? 'text-danger' : 'text-fg'}
        >
          {item.title}
        </span>
        {item.detail ? (
          <p className="m-0 text-label text-fg-muted">{item.detail}</p>
        ) : null}
        {item.unresolvedReason ? (
          <p className="m-0 text-label text-fg-muted">
            No location resolves this: {item.unresolvedReason}
          </p>
        ) : null}
      </div>
      <Link
        to="/records/$recordId/notebook"
        params={{ recordId }}
        hash={item.blockId ? `block-${item.blockId}` : undefined}
        className="shrink-0 text-label text-link"
      >
        {item.actionLabel}
      </Link>
    </li>
  )
}

function LinkedExperimentRow({
  label,
  experiment,
}: {
  label: string
  experiment: OverviewLinkedExperiment
}) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2 border-b border-border-subtle py-[5px] text-label last:border-b-0">
      <span className="text-fg-muted">{label}</span>
      <span>
        <Link
          to="/experiments/$expId"
          params={{ expId: experiment.id }}
          className="text-link"
        >
          <span className="mono">{experiment.identifier}</span>
        </Link>
        {experiment.title ? <> {experiment.title}</> : null}
        {experiment.status ? (
          <span className="text-fg-muted">
            {' '}
            · {experimentStatus(experiment.status).label}
          </span>
        ) : null}
      </span>
    </div>
  )
}

export function ExperimentOverview({
  record,
  blocks,
  links,
  readiness,
  readinessIsLoading = false,
  readinessError = null,
  signatures,
  signaturesIsLoading = false,
  signaturesIsError = false,
  followedBy,
  userLabel,
  projectName = null,
}: ExperimentOverviewProps) {
  const items = readinessItems(readiness, blocks, (userId) =>
    userId ? userLabel(userId) : 'Someone',
  )
  const objective = objectiveText(blocks)
  const status = experimentStatus(record.status)

  const protocolLinks = links.filter((link) => link.linkType === 'protocol')
  const datasetLinks = links.filter(
    (link) => link.linkType === 'dataset' && link.targetRecordId,
  )
  const analysisLinks = links.filter((link) => link.linkType === 'analysis')
  const upstream = links.filter(
    (link) =>
      (link.linkType === 'upstream' || link.linkType === 'follows') &&
      link.targetRecordId,
  )

  const properties = record.properties
  const collaboratorIds = propertyIds(properties, 'collaboratorIds')
  const reviewerId = propertyText(properties, 'reviewerId')
  const plannedEnd = propertyText(properties, 'plannedEnd')
  const clientId = propertyText(properties, 'clientId')

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-4 py-5 md:px-8">
        <Section title="Objective">
          {objective ? (
            <p className="m-0 max-w-[680px] whitespace-pre-line text-prose">
              {objective}
            </p>
          ) : (
            <Muted>
              No objective or notes are recorded in this experiment's notebook.
            </Muted>
          )}
        </Section>

        <Section title="Protocol progress">
          {protocolLinks.length ? (
            <DescriptionList
              labelWidth={110}
              items={protocolLinks.map((link) => [
                'Protocol',
                <Link
                  key={link.id}
                  to="/protocols/$protocolId"
                  params={{ protocolId: link.targetRecordId ?? '' }}
                  className="text-link"
                >
                  {link.targetIdentifier}
                </Link>,
              ])}
            />
          ) : (
            <Muted>This experiment does not follow a protocol.</Muted>
          )}
          <Muted>
            Step progress is not recorded: the experiment stores no protocol
            version, so per-step status, owner, time and evidence cannot be
            derived.
          </Muted>
        </Section>

        <Section
          title="Open before submission"
          count={items.length || undefined}
          action={readiness?.ready ? <Status tone="ok">Ready</Status> : null}
        >
          {readinessIsLoading ? (
            <Muted>Checking readiness…</Muted>
          ) : readinessError ? (
            <Muted>Readiness could not be checked: {readinessError}</Muted>
          ) : !readiness ? (
            <Muted>Readiness has not been checked.</Muted>
          ) : items.length ? (
            <ul className="m-0 list-none p-0">
              {items.map((item) => (
                <ReadinessRow key={item.id} item={item} recordId={record.id} />
              ))}
            </ul>
          ) : (
            <Muted>Nothing open. The record is ready for submission.</Muted>
          )}
        </Section>

        <Section title="Key results" action={<Muted>Preliminary</Muted>}>
          {datasetLinks.length || analysisLinks.length ? (
            <DescriptionList
              labelWidth={90}
              items={[
                ...(datasetLinks.length
                  ? ([
                      [
                        'Datasets',
                        <>
                          {datasetLinks.map((link, index) => (
                            <span key={link.id}>
                              {index ? ', ' : ''}
                              <Link
                                to="/datasets/$datasetId"
                                params={{
                                  datasetId: link.targetRecordId ?? '',
                                }}
                                className="text-link mono"
                              >
                                {link.targetIdentifier}
                              </Link>
                            </span>
                          ))}
                        </>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                ...(analysisLinks.length
                  ? ([
                      [
                        'Analyses',
                        <span key="analyses" className="mono">
                          {analysisLinks
                            .map((link) => link.targetIdentifier)
                            .join(', ')}
                        </span>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
          ) : (
            <Muted>
              No datasets or analyses are linked yet. Produced datasets appear
              on the Datasets tab.
            </Muted>
          )}
        </Section>
      </div>

      <Inspector className="w-[300px]">
        <InspectorSection title="Properties">
          <DescriptionList
            labelWidth={110}
            items={[
              ['Status', <Status tone={status.tone}>{status.label}</Status>],
              ['Owner', userLabel(record.createdByUserId)],
              [
                'Collaborators',
                collaboratorIds.length
                  ? collaboratorIds.map(userLabel).join(', ')
                  : 'Not recorded',
              ],
              ['Reviewer', reviewerId ? userLabel(reviewerId) : 'Not recorded'],
              ['Project', projectName ?? record.projectId ?? 'Not recorded'],
              ['Client', clientId ?? 'Not recorded'],
              [
                'Protocol',
                protocolLinks.length ? (
                  <Link
                    to="/protocols/$protocolId"
                    params={{
                      protocolId: protocolLinks[0]!.targetRecordId ?? '',
                    }}
                    className="text-link"
                  >
                    {protocolLinks[0]!.targetIdentifier}
                  </Link>
                ) : (
                  'Not recorded'
                ),
              ],
              ['Started', record.createdAt.slice(0, 10)],
              ['Planned end', plannedEnd ?? 'Not recorded'],
            ]}
          />
        </InspectorSection>

        <InspectorSection title="Linked experiments">
          {upstream.length || followedBy.length ? (
            <div className="flex flex-col">
              {upstream.map((link) => (
                <LinkedExperimentRow
                  key={link.id}
                  label="Upstream"
                  experiment={{
                    id: link.targetRecordId ?? '',
                    identifier: link.targetIdentifier,
                    title: '',
                    status: null,
                  }}
                />
              ))}
              {followedBy.map((experiment) => (
                <LinkedExperimentRow
                  key={experiment.id}
                  label="Next"
                  experiment={experiment}
                />
              ))}
            </div>
          ) : (
            <Muted>No linked experiments are recorded.</Muted>
          )}
        </InspectorSection>

        <InspectorSection title="Signatures">
          <SignaturesTable
            signatures={signatures}
            isLoading={signaturesIsLoading}
            isError={signaturesIsError}
          />
        </InspectorSection>
      </Inspector>
    </>
  )
}
