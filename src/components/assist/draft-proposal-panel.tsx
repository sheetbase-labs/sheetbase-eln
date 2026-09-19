/**
 * ASSIST-02 — Draft proposal panel.
 *
 * Preview-before-commit for every proposal kind: a marked-generated
 * banner, the deterministic preview, and Accept/Discard. The panel
 * never mutates anything itself — Accept calls
 * the host's `onAccept` (which executes the ordinary canonical operation:
 * block insert, mapping apply, spec load) and Discard calls `onDiscard`
 * leaving zero state.
 */
import { ASSISTANCE_NOTE } from '#/lib/assist-explain'
import type { AssistPhrasing } from '#/lib/assist-explain'
import type { AssistDraftProposal } from '#/lib/assist-drafts'
import { Button } from '#/components/ui'

export function DraftProposalPanel({
  proposal,
  phrasing,
  acceptLabel,
  accepting,
  onAccept,
  onDiscard,
}: {
  proposal: AssistDraftProposal
  phrasing?: AssistPhrasing | null
  acceptLabel?: string
  accepting?: boolean
  onAccept: () => void
  onDiscard: () => void
}) {
  return (
    <section
      aria-label={`Proposal: ${proposal.title}`}
      className="space-y-2 rounded-md border bg-muted/20 p-2 text-xs"
    >
      <p
        role="note"
        aria-label="Generated draft"
        className="rounded border border-dashed p-2 font-medium"
      >
        {proposal.marking.badge}
      </p>
      <h4 className="font-semibold">{proposal.title}</h4>
      <p>{proposal.summary}</p>
      <ProposalPreview proposal={proposal} />
      {phrasing ? (
        <blockquote className="space-y-1 rounded border border-dashed p-2">
          <p className="font-medium text-muted-foreground">
            Assistance phrasing ({phrasing.model}) — verify against the
            citations
          </p>
          <p>{phrasing.text}</p>
        </blockquote>
      ) : null}
      <p className="text-muted-foreground">{ASSISTANCE_NOTE}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={accepting} onClick={onAccept}>
          {acceptLabel ?? defaultAcceptLabel(proposal)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={accepting}
          onClick={onDiscard}
        >
          Discard
        </Button>
      </div>
    </section>
  )
}

function defaultAcceptLabel(proposal: AssistDraftProposal): string {
  switch (proposal.kind) {
    case 'notebook_text':
      return 'Accept and insert block'
    case 'import_mapping':
      return 'Accept and apply mapping'
    case 'chart_config':
      return 'Accept and load spec'
  }
}

function ProposalPreview({ proposal }: { proposal: AssistDraftProposal }) {
  switch (proposal.kind) {
    case 'notebook_text':
      return (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">
            Draft preview (rich_text block)
          </p>
          <p className="whitespace-pre-wrap rounded border p-2">
            {proposal.draftText}
          </p>
        </div>
      )
    case 'import_mapping':
      return (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">
            Mapping preview ({proposal.mappedCount} mapped,{' '}
            {proposal.ignoredCount} ignored)
          </p>
          <ul className="space-y-1">
            {proposal.suggestions.map((suggestion) => (
              <li key={suggestion.source}>
                <span className="font-mono">{suggestion.source}</span>
                {' → '}
                {suggestion.mapping.kind === 'field' ? (
                  <span className="font-mono">
                    {suggestion.mapping.field.label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">ignored</span>
                )}{' '}
                <span className="text-muted-foreground">
                  [{suggestion.confidence}] {suggestion.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'chart_config':
      return (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">
            Chart preview ({proposal.spec.type})
          </p>
          <p className="rounded border p-2">
            x: {proposal.spec.fields.x?.fieldId ?? 'none'} · y:{' '}
            {proposal.spec.fields.y.fieldId} · datasets:{' '}
            {proposal.spec.datasets.map((d) => d.datasetId).join(', ')}
          </p>
          <ul className="list-disc space-y-1 pl-4">
            {proposal.rationale.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )
  }
}
