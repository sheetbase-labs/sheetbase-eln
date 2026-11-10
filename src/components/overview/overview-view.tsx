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
import { Fragment } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { SignaturesTable } from '#/components/review/signatures-table'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/ui/layout'
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
import { ObjectLink } from '#/components/ui/object-link'
import { experimentStatus } from '#/components/experiments/experiments-data'
import { formatPartDate, partDate } from '#/lib/experiment-parts'
import type { PartSummary } from '#/lib/experiment-parts'
import type { SignatureWire } from '#/lib/signatures'
import { formatDate } from '#/lib/format-date'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { NotebookBlock, RecordWire } from '#/lib/notebook-data'
import { withReopen } from '#/lib/return-to'
import { t } from '#/copy'
import { keyResultsFrom } from './key-results'
import { protocolStepProgress, readinessItems } from './readiness'
import { stepProgress } from '#/lib/step-status'
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
  properties: NonNullable<RecordWire['properties']>
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
  /** The parts of an experiment that runs over several days; empty for a single page. */
  parts?: readonly PartSummary[]
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
  /** The scheduler for an experiment in parts, shown under the parts table. */
  schedule?: React.ReactNode
  /** "Have we done this before?": earlier work that reads like this. */
  similarWork?: React.ReactNode
}

/** The Objective section when the notebook has one, otherwise every prose
 * block in document order. */
function objectiveText(blocks: readonly ReadinessBlock[]): string {
  const objective = blocks.find((block) => {
    const first = firstNode(block.payload)

    return (
      first?.type === 'heading' && proseText.parse(first).trim() === 'Objective'
    )
  })

  if (objective) {
    const content = docContent(objective.payload)

    const text = content
      .slice(1)
      .map((node) => proseText.parse(node))
      .join('\n')
      .trim()

    if (text) return text
  }

  const parts: string[] = []

  for (const block of blocks) {
    const text = blockDocText(block.payload)

    if (text) parts.push(text)
  }

  return parts.join('\n\n')
}

// Preserve native object identity, inherited members and arrays with prose fields.
const nativeProseObject = z.custom<object>(
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Approved native-object boundary: JSON schemas reject supported nonplain objects and arrays.
  (value) => value !== null && typeof value === 'object',
)

function docContent(payload: NotebookBlock['payload']): unknown[] {
  const doc = payload.doc
  const parsed = nativeProseObject.safeParse(doc)

  if (!parsed.success || !('content' in parsed.data)) return []

  return Array.isArray(parsed.data.content) ? parsed.data.content : []
}

function firstNode(
  payload: NotebookBlock['payload'],
): { type?: unknown } | undefined {
  const [first] = docContent(payload)
  const parsed = nativeProseObject.safeParse(first)

  return parsed.success ? parsed.data : undefined
}

function blockDocText(payload: NotebookBlock['payload']): string {
  if (!('doc' in payload)) return ''
  const doc = payload.doc
  const parsed = nativeProseObject.safeParse(doc)

  if (!parsed.success || !('content' in parsed.data)) return ''
  const content = parsed.data.content

  return Array.isArray(content)
    ? content
        .map((node) => proseText.parse(node))
        .join('\n')
        .trim()
    : ''
}

const proseText = nativeProseObject
  .nullable()
  .catch(null)
  .transform((node): string => {
    if (node === null) return ''
    const text = 'text' in node ? node.text : undefined
    const parsedText = z.string().safeParse(text)

    if (parsedText.success) return parsedText.data
    const content = 'content' in node ? node.content : undefined

    return Array.isArray(content)
      ? content.map((child) => proseText.parse(child)).join('')
      : ''
  })

/** Read an optional list-valued property without inventing a shape. */
function propertyIds(
  properties: NonNullable<RecordWire['properties']>,
  key: string,
): string[] {
  const value = properties[key]

  if (!Array.isArray(value)) return []

  return value.filter(
    (entry): entry is string => z.string().safeParse(entry).success,
  )
}

function propertyText(
  properties: NonNullable<RecordWire['properties']>,
  key: string,
): string | null {
  const value = properties[key]
  const parsed = z.string().safeParse(value)

  return parsed.success && parsed.data.length > 0 ? parsed.data : null
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

function PartsSection({
  recordId,
  startedAt,
  parts,
  userLabel,
}: {
  recordId: string
  startedAt: string
  parts: readonly PartSummary[]
  userLabel: (userId: string) => string
}) {
  const done = parts.filter((part) => part.status === 'done').length

  return (
    <Section
      title={t('projects.overview.parts.title')}
      action={
        <span className="text-label text-fg-muted">
          {t('projects.overview.parts.done', {
            done: String(done),
            total: String(parts.length),
          })}
        </span>
      }
    >
      <TableBox className="mt-2">
        <Table aria-label={t('projects.overview.parts.title')}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>{t('projects.overview.parts.columns.part')}</TableHead>
              <TableHead>{t('projects.overview.parts.columns.day')}</TableHead>
              <TableHead>
                {t('projects.overview.parts.columns.status')}
              </TableHead>
              <TableHead>{t('projects.overview.parts.columns.by')}</TableHead>
              <TableHead>{t('projects.overview.parts.columns.when')}</TableHead>
              <TableHead>
                {t('projects.overview.parts.columns.steps')}
              </TableHead>
              <TableHead>
                {t('projects.overview.parts.columns.results')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parts.map((part) => (
              <TableRow key={part.partId}>
                <TableCell className="text-fg-muted">{part.number}</TableCell>
                <TableCell>
                  <Link
                    to="/experiments/$expId/notebook/$part"
                    params={{ expId: recordId, part: String(part.number) }}
                    className="text-link"
                  >
                    {part.title}
                  </Link>
                </TableCell>
                <TableCell className="text-fg-muted">
                  {t('projects.overview.parts.dayOn', {
                    day: String(part.dayOffset),
                    date: formatPartDate(partDate(startedAt, part.dayOffset)),
                  })}
                </TableCell>
                <TableCell>
                  {part.status === 'done' ? (
                    <Status tone="ok">{t('notebook.parts.stateDone')}</Status>
                  ) : part.status === 'now' ? (
                    <Status tone="progress">
                      {t('notebook.parts.stateNow')}
                    </Status>
                  ) : (
                    <Status tone="none">
                      {t('notebook.parts.stateLater')}
                    </Status>
                  )}
                </TableCell>
                <TableCell>
                  {part.status === 'done' && part.completedByUserId
                    ? userLabel(part.completedByUserId)
                    : part.assigneeUserId
                      ? userLabel(part.assigneeUserId)
                      : '—'}
                </TableCell>
                <TableCell className="text-fg-muted">
                  {part.completedAt
                    ? formatNotebookDateTime(part.completedAt)
                    : '—'}
                </TableCell>
                <TableCell className="text-fg-muted">
                  {part.stepCount > 0
                    ? t('projects.overview.parts.stepsOf', {
                        done: String(part.stepsDone),
                        total: String(part.stepCount),
                      })
                    : '—'}
                </TableCell>
                <TableCell className="text-fg-muted">
                  {part.resultCount > 0 ? part.resultCount : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
    </Section>
  )
}

export function ExperimentOverview({
  record,
  blocks,
  parts = [],
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
  schedule = null,
  similarWork = null,
}: ExperimentOverviewProps) {
  const navigate = useNavigate()
  const protocolSteps = protocolStepProgress(blocks)
  // With parts, steps are numbered within their part, as the notebook numbers
  // them, and grouped under it.
  const numberInPart = new Map<string, number>()
  const seenInPart = new Map<string | null, number>()

  for (const step of protocolSteps) {
    const next = (seenInPart.get(step.partId) ?? 0) + 1
    seenInPart.set(step.partId, next)
    numberInPart.set(step.blockId, next)
  }

  const partHeading = (partId: string | null) => {
    const part = parts.find((candidate) => candidate.partId === partId)

    return part
      ? t('projects.overview.parts.partHeading', {
          number: String(part.number),
          title: part.title,
        })
      : t('projects.overview.parts.noPart')
  }

  // Status comes from the evidence: a step with a note or a result is in progress.
  const stepStatus = new Map(
    stepProgress(blocks).map((step) => [step.blockId, step.status]),
  )

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

  const { metrics, conclusions } = keyResultsFrom(blocks)
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

  const recordedReviewerIds = [
    ...new Set([
      propertyText(properties, 'reviewerId'),
      ...(reviewerIds ?? []),
    ]),
  ].filter((id): id is string => Boolean(id))

  const reviewerNames = recordedReviewerIds.map((id) => userLabel(id))

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

        {parts.length > 0 ? (
          <PartsSection
            recordId={record.id}
            startedAt={record.createdAt}
            parts={parts}
            userLabel={userLabel}
          />
        ) : null}
        {parts.length > 0 ? schedule : null}

        {renderProtocolSection({
          protocolLinks,
          protocolSteps,
          parts,
          numberInPart,
          partHeading,
          stepStatus,
          userLabel,
        })}
        {renderReadinessSection({
          record,
          readiness,
          readinessIsLoading,
          readinessError,
          pastSubmission,
          items,
          navigate,
        })}
        {renderKeyResultsSection({
          metrics,
          conclusions,
          datasetLinks,
          analysisLinks,
        })}
      </div>

      <Inspector className="w-[300px]">
        {renderPropertiesSection({
          record,
          status,
          userLabel,
          collaboratorIds,
          reviewerNames,
          projectName,
          clientId,
          protocolLinks,
          plannedEnd,
          decision,
          decisionNotes,
        })}

        {addedFields}

        {similarWork}

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

function renderProtocolSection({
  protocolLinks,
  protocolSteps,
  parts,
  numberInPart,
  partHeading,
  stepStatus,
  userLabel,
}: {
  protocolLinks: OverviewLink[]
  protocolSteps: ReturnType<typeof protocolStepProgress>
  parts: readonly PartSummary[]
  numberInPart: ReadonlyMap<string, number>
  partHeading: (partId: string | null) => string
  stepStatus: ReadonlyMap<
    string,
    ReturnType<typeof stepProgress>[number]['status']
  >
  userLabel: ExperimentOverviewProps['userLabel']
}) {
  return (
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
                  done: protocolSteps.filter((step) => step.completed).length,
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
              {protocolSteps.map((step, index) => (
                <Fragment key={step.blockId}>
                  {parts.length > 0 &&
                  step.partId !== protocolSteps[index - 1]?.partId ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="bg-surface-sunken text-label font-semibold text-fg-muted"
                      >
                        {partHeading(step.partId)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <TableRow>
                    <TableCell className="text-fg-muted">
                      {parts.length > 0
                        ? (numberInPart.get(step.blockId) ?? '·')
                        : (step.stepNumber ?? '·')}
                    </TableCell>
                    <TableCell>{step.text}</TableCell>
                    <TableCell>
                      {step.completed ? (
                        <Status tone="ok">
                          {t('projects.overview.protocol.done')}
                        </Status>
                      ) : stepStatus.get(step.blockId) === 'in_progress' ? (
                        <Status tone="progress">
                          {t('projects.overview.protocol.inProgress')}
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
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      ) : protocolLinks.length ? (
        <Muted>{t('projects.overview.protocol.noProgress')}</Muted>
      ) : null}
    </Section>
  )
}

function renderReadinessSection({
  record,
  readiness,
  readinessIsLoading,
  readinessError,
  pastSubmission,
  items,
  navigate,
}: Pick<
  ExperimentOverviewProps,
  'record' | 'readiness' | 'readinessIsLoading' | 'readinessError'
> & {
  pastSubmission: boolean
  items: ReadinessItem[]
  navigate: ReturnType<typeof useNavigate>
}) {
  return (
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
            <Status tone="ok">{t('projects.overview.readiness.ready')}</Status>
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
      {renderReadinessContent({
        record,
        readiness,
        readinessIsLoading,
        readinessError,
        pastSubmission,
        items,
      })}
    </Section>
  )
}

function renderReadinessContent({
  record,
  readiness,
  readinessIsLoading,
  readinessError,
  pastSubmission,
  items,
}: Pick<
  ExperimentOverviewProps,
  'record' | 'readiness' | 'readinessIsLoading' | 'readinessError'
> & {
  pastSubmission: boolean
  items: ReadinessItem[]
}) {
  if (pastSubmission) {
    return (
      <Muted>
        {record.status === 'approved'
          ? t('projects.overview.readiness.after.approved')
          : record.status === 'returned'
            ? t('projects.overview.readiness.after.returned')
            : t('projects.overview.readiness.after.in_review')}
      </Muted>
    )
  }

  if (readinessIsLoading) {
    return <Muted>{t('projects.overview.readiness.checking')}</Muted>
  }

  if (readinessError) {
    return (
      <Muted>
        {t('projects.overview.readiness.failed', { reason: readinessError })}
      </Muted>
    )
  }

  if (!readiness) {
    return <Muted>{t('projects.overview.readiness.notChecked')}</Muted>
  }

  if (items.length) {
    return (
      <ul className="m-0 list-none p-0">
        {items.map((item) => (
          <ReadinessRow key={item.id} item={item} recordId={record.id} />
        ))}
      </ul>
    )
  }

  return <Muted>{t('projects.overview.readiness.nothingOpen')}</Muted>
}

function renderKeyResultsSection({
  metrics,
  conclusions,
  datasetLinks,
  analysisLinks,
}: ReturnType<typeof keyResultsFrom> & {
  datasetLinks: OverviewLink[]
  analysisLinks: OverviewLink[]
}) {
  return (
    <Section
      title={t('projects.overview.results.title')}
      action={<Muted>{t('projects.overview.results.preliminary')}</Muted>}
    >
      {metrics.length || conclusions.length ? (
        <div className="mb-4 flex flex-col gap-4" data-key-results>
          {metrics.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 p-0">
              {metrics.map((metric) => (
                <li
                  key={metric.id}
                  className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2.5"
                >
                  <span className="text-label text-fg-muted">
                    {metric.label}
                  </span>
                  <span className="text-title tabular-nums">
                    {metric.value}
                    {metric.unit ? (
                      <span className="ml-1 text-label font-normal text-fg-muted">
                        {metric.unit}
                      </span>
                    ) : null}
                  </span>
                  {metric.provenance ? (
                    <span className="text-label text-fg-muted">
                      {metric.provenance}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {conclusions.map((conclusion) => (
            <div
              key={conclusion.id}
              className="flex max-w-[680px] flex-col gap-1"
            >
              <p className="m-0 text-prose">
                {conclusion.verdict ? (
                  <span className="mr-2 text-label font-medium capitalize text-fg-muted">
                    {conclusion.verdict}
                  </span>
                ) : null}
                {conclusion.text}
              </p>
              {conclusion.basis ? (
                <p className="m-0 text-label text-fg-muted">
                  {t('projects.overview.results.basedOn', {
                    basis: conclusion.basis,
                  })}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
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
                ] satisfies [string, React.ReactNode][])
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
                ] satisfies [string, React.ReactNode][])
              : []),
          ]}
        />
      ) : metrics.length || conclusions.length ? null : (
        <Muted>{t('projects.overview.results.none')}</Muted>
      )}
    </Section>
  )
}

function renderPropertiesSection({
  record,
  status,
  userLabel,
  collaboratorIds,
  reviewerNames,
  projectName,
  clientId,
  protocolLinks,
  plannedEnd,
  decision,
  decisionNotes,
}: Pick<ExperimentOverviewProps, 'record' | 'userLabel' | 'projectName'> & {
  status: ReturnType<typeof experimentStatus>
  collaboratorIds: string[]
  reviewerNames: string[]
  clientId: string | null
  protocolLinks: OverviewLink[]
  plannedEnd: string | null
  decision: string | null
  decisionNotes: string | null
}) {
  return (
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
          ...(collaboratorIds.length
            ? ([
                [
                  t('projects.overview.properties.collaborators'),
                  collaboratorIds.map(userLabel).join(', '),
                ],
              ] satisfies [React.ReactNode, React.ReactNode][])
            : []),
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
          ...(clientId
            ? ([
                [t('projects.overview.properties.client'), clientId],
              ] satisfies [React.ReactNode, React.ReactNode][])
            : []),
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
          ...(plannedEnd
            ? ([
                [
                  t('projects.overview.properties.plannedEnd'),
                  formatDate(plannedEnd),
                ],
              ] satisfies [React.ReactNode, React.ReactNode][])
            : []),
          ...(decision
            ? ([
                [
                  t('projects.overview.properties.decision'),
                  `${decision.charAt(0).toUpperCase()}${decision.slice(1)}${decisionNotes ? ` · ${decisionNotes}` : ''}`,
                ],
              ] satisfies [React.ReactNode, React.ReactNode][])
            : []),
        ]}
      />
    </InspectorSection>
  )
}
