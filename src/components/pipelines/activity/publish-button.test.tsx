// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { pipelineVersion, renderPipeline } from '../test-support'
import { PublishButton } from './publish-button'
import type { PublishApproval } from './use-publish-approval'

type Seen = Pick<PublishApproval, 'canDecide' | 'busy'> & {
  pending: { object_id: string } | null
}

// The button reads only these few fields of the approval.
function approval(seen: Partial<Seen> = {}): PublishApproval {
  const base: Seen & { ask: { isPending: boolean; mutate: () => void } } = {
    pending: null,
    canDecide: false,
    busy: false,
    ask: { isPending: false, mutate: () => {} },
    ...seen,
  }

  // SAFETY: a stand-in carrying every field PublishButton reads.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  return base as unknown as PublishApproval
}

describe('PublishButton', () => {
  const draft = pipelineVersion()

  it('asks for a reason before requesting approval', async () => {
    renderPipeline(
      <PublishButton
        pipelineId="p-1"
        version={draft.version}
        draftId={draft.id}
        versions={[draft]}
        approval={approval()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Publish v2/ }))
    expect(await screen.findByText('Publish v2?')).toBeTruthy()
  })

  it('says it is waiting while a request is pending', () => {
    renderPipeline(
      <PublishButton
        pipelineId="p-1"
        version={draft.version}
        draftId={draft.id}
        versions={[draft]}
        approval={approval({ pending: { object_id: draft.id } })}
      />,
    )
    const waiting = screen.getByRole('button', { name: 'Waiting for approval' })
    expect(waiting.hasAttribute('disabled')).toBe(true)
  })
})
