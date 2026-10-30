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
import { Link, useNavigate } from '@tanstack/react-router'

import { SignaturesTable } from '#/components/review/signatures-table'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
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
import { ObjectLink } from '#/components/v3/ui/object-link'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import type { SignatureWire } from '#/lib/signatures'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { withReopen } from '#/lib/return-to'
import { t } from '#/copy'
import { protocolStepProgress, readinessItems } from './readiness'
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
  /** Reviewers assigned on the latest submission, when there is one. */
  reviewerIds?: readonly string[]
  projectName?: string | null
  /** Panels for the fields the workspace added to Experiment. */
  addedFields?: React.ReactNode
}

/** The Objective section when the notebook has one, otherwise every prose
 * block in document order. */
function objectiveText(blocks: readonly ReadinessBlock[]): string {
  const objective = blocks.find((block) => {
    const first = firstNode(block.payload)
    return first?.type === 'heading' && proseText(first).trim() === 'Objective'
  })
  if (objective) {
    const content = docContent(objective.payload)
    const text = content.slice(1).map(proseText).join('\n').trim()
    if (text) return text
  }
  const parts: string[] = []
  for (const block of blocks) {
    const text = blockDocText(block.payload)
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

function docContent(payload: Record<string, unknown>): unknown[] {
  const doc = payload.doc
  if (!doc || typeof doc !== 'object' || !('content' in doc)) return []
  return Array.isArray(doc.content) ? doc.content : []
}

function firstNode(
  payload: Record<string, unknown>,
): { type?: unknown } | undefined {
  const [first] = docContent(payload)
  return first && typeof first === 'object' ? first : undefined
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
            {t('projects.overview.noLocation', {
              reason: item.unresolvedReason,
            })}
          </p>
        ) : null}
      </div>
      <Link
        to="/experiments/$expId/notebook"
        params={{ expId: recordId }}
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
  reviewerIds,
  projectName = null,
  addedFields = null,
}: ExperimentOverviewProps) {
  const navigate = useNavigate()
  const protocolSteps = protocolStepProgress(blocks)
  const items = readinessItems(readiness, blocks, (userId) =>
    userId ? userLabel(userId) : t('projects.overview.someone'),
  )
  const objective = objectiveText(blocks)
  const status = experimentStatus(record.status)
  // Once a record has been submitted the list of what to close before
  // submitting no longer applies; the review is what the page is about.
  const pastSubmission = ['in_review', 'returned', 'approved'].includes(
    record.status,
  )

  const protocolLinks = links.filter((link) => link.linkType === 'protocol')
  // A produced dataset is linked by identifier, and the dataset row is not
  // always addressable (`target_record_id` is null for seeded links). The
  // Datasets and Results tabs count these by `targetKind`, so the Overview has
  // to use the same predicate — filtering on `targetRecordId` denied data the
  // same page counted.
  const datasetLinks = links.filter((link) => link.targetKind === 'dataset')
  const analysisLinks = links.filter((link) => link.targetKind === 'analysis')
  const upstream = links.filter(
    (link) =>
      (link.linkType === 'upstream' || link.linkType === 'follows') &&
      link.targetRecordId,
  )

  const properties = record.properties
  const collaboratorIds = propertyIds(properties, 'collaboratorIds')
  const reviewerNames = [
    ...new Set([
      propertyText(properties, 'reviewerId'),
      ...(reviewerIds ?? []),
    ]),
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => userLabel(id))
  const plannedEnd = propertyText(properties, 'plannedEnd')
  const decision = propertyText(properties, 'decision')
  const decisionNotes = propertyText(properties, 'decisionNotes')
  const clientId = propertyText(properties, 'clientId')

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-4 py-5 md:px-8">
        <Section title={t('projects.overview.objective.title')}>
          {objective ? (
            <p className="m-0 max-w-[680px] whitespace-pre-line text-prose">
              {objective}
            </p>
          ) : (
            <Muted>{t('projects.overview.objective.empty')}</Muted>
          )}
        </Section>

        <Section
          title={t('projects.overview.protocol.title')}
          action={
            protocolLinks.length ? (
              <span className="flex items-center gap-2 text-label text-fg-muted">
                {protocolLinks.map((link) => (
                  <Link
                    key={link.id}
                    to="/protocols/$protocolId"
                    params={{ protocolId: link.targetRecordId ?? '' }}
                    className="text-link mono"
                  >
                    {link.targetIdentifier}
                  </Link>
                ))}
                {protocolSteps.length
                  ? `· ${t('projects.overview.protocol.stepsDone', {
                      done: protocolSteps.filter((step) => step.completed)
                        .length,
                      total: protocolSteps.length,
                    })}`
                  : null}
              </span>
            ) : null
          }
        >
          {protocolLinks.length ? null : (
            <Muted>{t('projects.overview.protocol.none')}</Muted>
          )}
          {protocolSteps.length ? (
            <TableBox className="mt-2">
              <Table aria-label={t('projects.overview.protocol.title')}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>
                      {t('projects.overview.protocol.columns.step')}
                    </TableHead>
                    <TableHead>
                      {t('projects.overview.protocol.columns.status')}
                    </TableHead>
                    <TableHead>
                      {t('projects.overview.protocol.columns.by')}
                    </TableHead>
                    <TableHead>
                      {t('projects.overview.protocol.columns.when')}
                    </TableHead>
                    <TableHead>
                      {t('projects.overview.protocol.columns.evidence')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {protocolSteps.map((step) => (
                    <TableRow key={step.blockId}>
                      <TableCell className="text-fg-muted">
                        {step.stepNumber ?? '·'}
                      </TableCell>
                      <TableCell>{step.text}</TableCell>
                      <TableCell>
                        {step.completed ? (
                          <Status tone="ok">
                            {t('projects.overview.protocol.done')}
                          </Status>
                        ) : (
                          <Status tone="none">
                            {t('projects.overview.protocol.notStarted')}
                          </Status>
                        )}
                      </TableCell>
                      <TableCell>
                        {step.completed
                          ? step.completedByUserId
                            ? userLabel(step.completedByUserId)
                            : t('projects.overview.notRecorded')
                          : '—'}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {step.completed && step.completedAt
                          ? formatNotebookDateTime(step.completedAt)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {step.note || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>{t('projects.overview.protocol.noProgress')}</Muted>
          )}
        </Section>

        <Section
          title={
            pastSubmission
              ? t('projects.overview.readiness.reviewTitle')
              : t('projects.overview.readiness.title')
          }
          count={pastSubmission ? undefined : items.length || undefined}
          action={
            <span className="inline-flex items-center gap-2">
              {!pastSubmission && readiness?.ready ? (
                <Status tone="ok">
                  {t('projects.overview.readiness.ready')}
                </Status>
              ) : null}
              {record.status === 'in_progress' ? (
                // Submitting lives in the notebook's dialog; `reopen=submit`
                // opens it there, so the readiness list above is one click
                // from the action it is about.
                <Button
                  variant={readiness?.ready ? 'primary' : 'secondary'}
                  onClick={() =>
                    void navigate({
                      href: withReopen(
                        `/experiments/${record.id}/notebook`,
                        'submit',
                      ),
                    })
                  }
                >
                  {t('projects.overview.readiness.submit')}
                </Button>
              ) : null}
            </span>
          }
        >
          {pastSubmission ? (
            <Muted>
              {record.status === 'approved'
                ? t('projects.overview.readiness.after.approved')
                : record.status === 'returned'
                  ? t('projects.overview.readiness.after.returned')
                  : t('projects.overview.readiness.after.in_review')}
            </Muted>
          ) : readinessIsLoading ? (
            <Muted>{t('projects.overview.readiness.checking')}</Muted>
          ) : readinessError ? (
            <Muted>
              {t('projects.overview.readiness.failed', {
                reason: readinessError,
              })}
            </Muted>
          ) : !readiness ? (
            <Muted>{t('projects.overview.readiness.notChecked')}</Muted>
          ) : items.length ? (
            <ul className="m-0 list-none p-0">
              {items.map((item) => (
                <ReadinessRow key={item.id} item={item} recordId={record.id} />
              ))}
            </ul>
          ) : (
            <Muted>{t('projects.overview.readiness.nothingOpen')}</Muted>
          )}
        </Section>

        <Section
          title={t('projects.overview.results.title')}
          action={<Muted>{t('projects.overview.results.preliminary')}</Muted>}
        >
          {datasetLinks.length || analysisLinks.length ? (
            <DescriptionList
              labelWidth={90}
              items={[
                ...(datasetLinks.length
                  ? ([
                      [
                        t('projects.overview.results.datasets'),
                        <>
                          {datasetLinks.map((link, index) => (
                            <span key={link.id}>
                              {index ? ', ' : ''}
                              {link.targetRecordId ? (
                                <Link
                                  to="/datasets/$datasetId"
                                  params={{
                                    datasetId: link.targetRecordId,
                                  }}
                                  className="text-link mono"
                                >
                                  {link.targetIdentifier}
                                </Link>
                              ) : (
                                <span className="mono">
                                  {link.targetIdentifier}
                                </span>
                              )}
                            </span>
                          ))}
                        </>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                ...(analysisLinks.length
                  ? ([
                      [
                        t('projects.overview.results.analyses'),
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
            <Muted>{t('projects.overview.results.none')}</Muted>
          )}
        </Section>
      </div>

      <Inspector className="w-[300px]">
        <InspectorSection title={t('projects.overview.properties.title')}>
          <DescriptionList
            labelWidth={110}
            items={[
              [
                t('projects.overview.properties.status'),
                <Status tone={status.tone}>{status.label}</Status>,
              ],
              [
                t('projects.overview.properties.owner'),
                userLabel(record.createdByUserId),
              ],
              [
                t('projects.overview.properties.collaborators'),
                collaboratorIds.length
                  ? collaboratorIds.map(userLabel).join(', ')
                  : t('projects.overview.notRecorded'),
              ],
              [
                t('projects.overview.properties.reviewer'),
                reviewerNames.length
                  ? reviewerNames.join(', ')
                  : t('projects.overview.notRecorded'),
              ],
              [
                t('projects.overview.properties.project'),
                record.projectId ? (
                  <ObjectLink kind="project" id={record.projectId} mono={false}>
                    {projectName ??
                      t('projects.overview.properties.projectFallback')}
                  </ObjectLink>
                ) : (
                  t('projects.overview.notRecorded')
                ),
              ],
              [
                t('projects.overview.properties.client'),
                clientId ?? t('projects.overview.notRecorded'),
              ],
              [
                t('projects.overview.properties.protocol'),
                protocolLinks.length ? (
                  <Link
                    to="/protocols/$protocolId"
                    params={{
                      protocolId: protocolLinks[0].targetRecordId ?? '',
                    }}
                    className="text-link"
                  >
                    {protocolLinks[0].targetIdentifier}
                  </Link>
                ) : (
                  t('projects.overview.notRecorded')
                ),
              ],
              [
                t('projects.overview.properties.started'),
                formatNotebookDateTime(record.createdAt),
              ],
              [
                t('projects.overview.properties.plannedEnd'),
                plannedEnd ?? t('projects.overview.notRecorded'),
              ],
              [
                t('projects.overview.properties.decision'),
                decision
                  ? `${decision.charAt(0).toUpperCase()}${decision.slice(1)}${decisionNotes ? ` · ${decisionNotes}` : ''}`
                  : t('projects.overview.notRecorded'),
              ],
            ]}
          />
        </InspectorSection>

        {addedFields}

        <InspectorSection title={t('projects.overview.linked.title')}>
          {upstream.length || followedBy.length ? (
            <div className="flex flex-col">
              {upstream.map((link) => (
                <LinkedExperimentRow
                  key={link.id}
                  label={t('projects.overview.linked.upstream')}
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
                  label={t('projects.overview.linked.next')}
                  experiment={experiment}
                />
              ))}
            </div>
          ) : (
            <Muted>{t('projects.overview.linked.none')}</Muted>
          )}
        </InspectorSection>

        <InspectorSection title={t('projects.overview.signatures')}>
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
