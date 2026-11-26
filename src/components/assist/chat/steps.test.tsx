import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StepList, stepCallOf } from './steps'

vi.mock('#/components/ui/linked-text', () => ({
  LinkedText: ({ text }: { text: string }) => <span>{text}</span>,
}))

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

  it('shows the records a lookup found and why a step failed', () => {
    render(
      <StepList
        calls={[
          search('PicoGreen'),
          stepCallOf({
            toolName: 'sheetbase.templates.read',
            input: { template: 'T-12' },
            state: 'output-error',
            errorText: 'Template not found.',
          }),
        ]}
      />,
    )

    expect(screen.getByText(/Found SMP-0042 and SMP-0043/)).toBeTruthy()
    expect(
      screen.getByText('Couldn’t open template T-12: template not found'),
    ).toBeTruthy()
    expect(
      screen
        .getAllByTestId('assistant-lookup')
        .map((row) => row.getAttribute('data-state')),
    ).toEqual(['done', 'failed'])
  })
})
