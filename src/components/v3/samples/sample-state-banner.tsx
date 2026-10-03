import type { ReactNode } from 'react'

import { Banner } from '#/components/v3/ui/alert'
import type { SampleEvent, SampleRecord } from '#/lib/samples'

import { describeSampleState } from './sample-state'

/**
 * LAB-02 step 3 — the sample detail's hold / quarantine / consumed / disposal
 * banner (SampleQuarantine, SampleExpired, SampleConsumed). It renders nothing
 * for a sample in a normal lifecycle state, and otherwise states the real
 * reason and date with the action the design places beside it.
 */
export function SampleStateBanner({
  sample,
  events,
  userName,
  action,
}: {
  sample: SampleRecord
  events?: SampleEvent[]
  userName?: (userId: string) => string | null
  action?: ReactNode
}) {
  const state = describeSampleState(sample, { events, userName })
  if (!state) return null
  return (
    <Banner tone={state.tone} title={state.title} action={action}>
      {state.body}
    </Banner>
  )
}
