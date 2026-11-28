import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ExperimentStateLine } from './-experiment-header'

const line = (isAuthor: boolean) => (
  <ExperimentStateLine
    reviewing={false}
    inReview
    ownerName="Tom H."
    isAuthor={isAuthor}
    submittedAt="2026-11-26T10:02:00Z"
    waitingNames={['Gareth P.']}
  />
)

describe('experiment review line', () => {
  it('tells the author they submitted it', () => {
    render(line(true))
    expect(screen.getByText(/^You submitted this version/)).toBeTruthy()
  })

  it('names the author to anyone else, never "You submitted"', () => {
    render(line(false))
    expect(screen.getByText(/^Tom H\. submitted this version/)).toBeTruthy()
    expect(screen.queryByText(/You submitted/)).toBeNull()
  })
})
