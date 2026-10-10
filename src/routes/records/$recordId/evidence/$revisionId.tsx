/**
 * REV-04.2 — the evidence view of a signed revision.
 *
 * The frozen revision is not reconstructed here: the page shows the server's evidence
 * package (the canonical snapshot's digest and the evidence it cites) beside the drift
 * read model, so a reader can see what has moved since signing without the client
 * inferring it. The export package remains the machine-readable artefact and is linked
 * from the header.
 */
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { DescriptionList, Section } from '#/components/v3/ui/layout'
import { InspectorSection } from '#/components/record/inspector-sections'
import {
  fetchRevisionDrift,
  fetchRevisionEvidencePackage,
  revisionEvidenceQueryKeys,
} from '#/lib/revision-evidence'
import { notebookDataClient } from '#/lib/notebook-data'

export const Route = createFileRoute('/records/$recordId/evidence/$revisionId')(
  {
    beforeLoad: async ({ context: rootContext }) => {
      const context = rootContext.auth
      if (!context) throw redirect({ to: '/sign-in' })
      return { context }
    },
    component: RevisionEvidenceRoute,
  },
)

function day(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function RevisionEvidenceRoute() {
  const { recordId, revisionId } = Route.useParams()

  const drift = useQuery({
    queryKey: revisionEvidenceQueryKeys.drift(revisionId),
    queryFn: () => fetchRevisionDrift(notebookDataClient, revisionId),
  })
  const packageData = useQuery({
    queryKey: revisionEvidenceQueryKeys.package(revisionId),
    queryFn: () => fetchRevisionEvidencePackage(notebookDataClient, revisionId),
  })

  const state = drift.data

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-doc font-semibold">Evidence</h1>
        {state ? (
          <span className="mono text-fg-muted">
            {state.record.identifier} · signed {day(state.signedAt)}
          </span>
        ) : null}
        <Status tone={state?.drifted ? 'warn' : 'ok'}>
          {state?.drifted ? 'Moved since signing' : 'Matches signing'}
        </Status>
        <Link
          to="/api/export/revision/$id/package"
          params={{ id: revisionId }}
          className="ml-auto text-link"
        >
          Export package
        </Link>
      </header>

      <div className="grid gap-x-10 gap-y-[26px] md:grid-cols-2">
        <Section title="Signed revision">
          <DescriptionList
            labelWidth={132}
            items={[
              ['Revision', <span className="mono">{revisionId}</span>],
              ['Record', <span className="mono">{recordId}</span>],
              ['Name at signing', state?.record.signedTitle ?? '—'],
              [
                'Integrity digest',
                <span className="mono text-label">
                  {packageData.data?.revision?.integrityDigest ?? '—'}
                </span>,
              ],
              ['Reason', packageData.data?.revision?.reason ?? '—'],
              ['Signed', day(state?.signedAt)],
            ]}
          />
        </Section>

        <Section title="Drift">
          <DescriptionList
            labelWidth={132}
            items={[
              [
                'Record name',
                state?.record.renamed
                  ? `${state.record.signedTitle ?? '—'} → ${state.record.currentTitle}`
                  : (state?.record.currentTitle ?? '—'),
              ],
              [
                'Instruments',
                state && state.instruments.length > 0
                  ? state.instruments.map((instrument) => (
                      <div key={instrument.instrumentId}>
                        {instrument.displayId ? (
                          <>
                            <span className="mono">{instrument.displayId}</span>
                            {' · '}
                          </>
                        ) : null}
                        {instrument.renamed
                          ? `${instrument.signedName ?? '—'} → ${instrument.currentName ?? '—'}`
                          : (instrument.currentName ?? '—')}
                      </div>
                    ))
                  : '—',
              ],
              [
                'Comments after signing',
                String(state?.commentsAfterSigning ?? 0),
              ],
              [
                'Cited datasets',
                state && state.datasets.length > 0
                  ? state.datasets.map((dataset) => (
                      <div key={dataset.citedVersionId}>
                        <span className="mono">{dataset.datasetId}</span>
                        {dataset.changed
                          ? ' · latest version differs'
                          : ' · still the cited version'}
                      </div>
                    ))
                  : '—',
              ],
            ]}
          />
        </Section>
      </div>

      {packageData.data?.comments?.length ? (
        <Section title="Comments at signing">
          <InspectorSection title="Comments">
            <p className="text-label text-fg-muted">
              {packageData.data.comments.length} comment
              {packageData.data.comments.length === 1 ? '' : 's'} frozen with
              this revision.
            </p>
          </InspectorSection>
        </Section>
      ) : null}
    </div>
  )
}
