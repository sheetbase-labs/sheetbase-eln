import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { stepCallOf } from './step-call'
import { StepList } from './steps'

const Plain = ({ text }: { text: string }) => <span>{text}</span>

afterEach(cleanup)

const search = (query: string) =>
  stepCallOf({
    toolName: 'sheetbase.search',
    input: { query },
    state: 'output-available',
    output: { ok: true, refs: ['SMP-0042', 'SMP-0043'] },
  })

describe('StepList', () => {
  it('says searches in a row as one line, with each one a step away', async () => {
    const user = userEvent.setup()

    render(
      <StepList
        Text={Plain}
        calls={[
          search('PicoGreen'),
          stepCallOf({
            toolName: 'sheetbase.protocol.read',
            input: { query: 'PicoGreen' },
            state: 'output-available',
          }),
        ]}
      />,
    )

    expect(screen.getAllByTestId('assistant-lookup')).toHaveLength(1)
    expect(
      screen.getByText(
        'Searched the workspace and protocols for “PicoGreen” (2 searches)',
      ),
    ).toBeTruthy()
    expect(screen.queryByTestId('assistant-lookup-each')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show each step' }))

    expect(screen.getByTestId('assistant-lookup-each').children).toHaveLength(2)
  })

  it('shows the records a lookup found and why a card failed', () => {
    render(
      <StepList
        Text={Plain}
        calls={[
          search('PicoGreen'),
          stepCallOf({
            toolName: 'sheetbase.booking.create',
            input: { instrument: 'Plate reader' },
            state: 'output-error',
            errorText: 'That time is taken.',
          }),
        ]}
      />,
    )

    expect(screen.getByText(/Found SMP-0042 and SMP-0043/)).toBeTruthy()
    expect(screen.getByText(/that time is taken$/)).toBeTruthy()
    expect(
      screen
        .getAllByTestId('assistant-lookup')
        .map((row) => row.getAttribute('data-state')),
    ).toEqual(['done', 'failed'])
  })

  it('leaves a failed lookup out, so its raw error never shows', () => {
    render(
      <StepList
        Text={Plain}
        calls={[
          stepCallOf({
            toolName: 'sheetbase.canonical.read',
            input: { resource: 'review_submissions' },
            state: 'output-error',
            errorText:
              "Filter 'experiment_ref' is not a readable column on review_submissions.",
          }),
          search('PicoGreen'),
        ]}
      />,
    )

    expect(screen.queryByText(/experiment_ref/)).toBeNull()
    expect(
      screen
        .getAllByTestId('assistant-lookup')
        .map((row) => row.getAttribute('data-state')),
    ).toEqual(['done'])
  })
})
