import * as React from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import type { MentionCandidate } from '#/lib/mentions'

import { MentionTextarea } from './mention-textarea'

type ComposerTarget = {
  onBlock: boolean
  onNotebook: boolean
  onSelection: boolean
}

function placeholderFor(target: ComposerTarget): string {
  if (target.onBlock) return t('notebook.commentPanel.addOnBlock')

  if (target.onNotebook) return t('notebook.commentPanel.addOnNotebook')

  if (target.onSelection) return t('notebook.commentPanel.addOnSelection')

  return t('notebook.commentPanel.addOnRevision')
}

/**
 * The panel's new-comment form: the mention-aware textarea, the send button
 * and the refusal it last reported. `draft` swaps the wording for a reviewer
 * whose comment is a private draft until the return decision is published.
 */
export function CommentComposer({
  newBody,
  onChange,
  onSubmit,
  pending,
  mentionCandidates,
  draft,
  target,
}: {
  newBody: string
  onChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  pending: boolean
  mentionCandidates: MentionCandidate[]
  draft: boolean
  /** Which surface is being commented on, so the hint names it. */
  target: ComposerTarget
}) {
  const placeholder = placeholderFor(target)

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-2 border-t pt-3">
        <MentionTextarea
          className="min-h-[70px] w-full rounded-md border bg-surface px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={placeholder}
          value={newBody}
          onChange={onChange}
          candidates={mentionCandidates}
          aria-label={t('notebook.commentPanel.ariaLabelNewCommentBody')}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!newBody.trim() || pending}>
            <Icon name="comment" className="size-3" aria-hidden="true" />
            {draft
              ? t('notebook.commentPanel.addDraftComment')
              : t('notebook.commentPanel.addComment')}
          </Button>
          {pending ? (
            <span className="text-xs text-fg-muted">
              {t('notebook.commentPanel.sending')}
            </span>
          ) : null}
        </div>
        {draft ? (
          <p className="text-xs text-fg-muted">
            {t('notebook.commentPanel.draftNotSentTo')}
          </p>
        ) : null}
      </form>
    </>
  )
}
