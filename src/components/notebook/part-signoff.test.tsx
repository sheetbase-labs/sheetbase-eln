import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { partsProgress } from '#/lib/experiment-parts'
import type { ExperimentPart } from '#/lib/experiment-parts'
import type { PartSignoffStatus } from '#/lib/part-signoff'
import { SignOffPartCard, SignedPartBanner } from './part-signoff'

afterEach(cleanup)

const wire = (
  id: string,
  position: number,
  extra: Partial<ExperimentPart> = {},
): ExperimentPart => ({
  id,
  recordId: 'rec',
  position,
  title: `Part ${position}`,
  dayOffset: position - 1,
  assigneeUserId: null,
  openedAt: null,
  completedAt: null,
  completedByUserId: null,
  requiresSignOff: true,
  signedOffAt: null,
  signedOffByUserId: null,
  signoffId: null,
  ...extra,
})

const status = (extra: Partial<PartSignoffStatus> = {}): PartSignoffStatus => ({
  partId: 'a',
  partNumber: 1,
  title: 'Part 1',
  requiresSignOff: true,
  workDone: true,
  awaitingSignOff: false,
  signed: true,
  signoffId: 'sig',
  signedAt: '2026-11-03T10:00:00Z',
  signedByUserId: 'u1',
  signerName: 'Priya Shah',
  snapshotDigest: 'abc',
  countersignedBy: [],
  countersignRequestedFrom: [],
  signRequestedFrom: [],
  amendmentCount: 0,
  lastAmendedAt: null,
  lastAmendmentReason: null,
  ...extra,
})

function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })

  client.setQueryData(['user-names', ['u2']], { u2: 'Name of u2' })
  client.setQueryData(['user-names', ['u9']], { u9: 'Name of u9' })
  client.setQueryData(['user-names', []], {})

  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

describe('SignOffPartCard', () => {
  const progress = partsProgress([wire('a', 1), wire('b', 2)], [])
  const [first, second] = progress

  it('names the part to sign and the one that opens after it', () => {
    wrap(
      <SignOffPartCard
        recordId="rec"
        part={first}
        next={second}
        status={status({ signed: false, awaitingSignOff: true })}
        canEdit
        currentUserName="Gareth"
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Sign off Part 1 to open Part 2' }),
    ).toBeTruthy()
    expect(screen.getByTestId('sign-off-part')).toBeTruthy()
  })

  it('offers no way to sign to someone who cannot edit', () => {
    wrap(
      <SignOffPartCard
        recordId="rec"
        part={first}
        next={second}
        status={undefined}
        canEdit={false}
        currentUserName="Gareth"
      />,
    )
    expect(screen.queryByTestId('sign-off-part')).toBeNull()
  })

  it('opens the signing dialog', () => {
    wrap(
      <SignOffPartCard
        recordId="rec"
        part={first}
        next={null}
        status={undefined}
        canEdit
        currentUserName="Gareth"
      />,
    )
    fireEvent.click(screen.getByTestId('sign-off-part'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('says who it is waiting on', () => {
    wrap(
      <SignOffPartCard
        recordId="rec"
        part={first}
        next={second}
        status={status({ signed: false, signRequestedFrom: ['u9'] })}
        canEdit
        currentUserName="Gareth"
      />,
    )
    expect(screen.getByText(/Waiting for Name of u9 to sign/)).toBeTruthy()
  })
})

describe('SignedPartBanner', () => {
  const [first] = partsProgress([wire('a', 1)], [])

  it('shows who signed and the way to amend', () => {
    wrap(
      <SignedPartBanner
        recordId="rec"
        part={first}
        status={status({ countersignedBy: ['u2'] })}
        canEdit
        currentUserName="Gareth"
        hasCountersignRequest={false}
      />,
    )
    expect(screen.getByTestId('part-signed-banner').textContent).toContain(
      'Signed by Priya Shah',
    )
    expect(screen.getByText(/Countersigned by Name of u2/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('amend-part'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows a countersign button only to the person asked', () => {
    const { rerender } = wrap(
      <SignedPartBanner
        recordId="rec"
        part={first}
        status={status()}
        canEdit={false}
        currentUserName="Sam"
        hasCountersignRequest
      />,
    )

    expect(screen.getByTestId('countersign-part')).toBeTruthy()
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SignedPartBanner
          recordId="rec"
          part={first}
          status={status()}
          canEdit={false}
          currentUserName="Sam"
          hasCountersignRequest={false}
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('countersign-part')).toBeNull()
    expect(screen.queryByTestId('amend-part')).toBeNull()
  })
})
