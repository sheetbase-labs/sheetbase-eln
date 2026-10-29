import { describe, expect, it } from 'vitest'

import { readReviewWorkflow } from './use-signature-policy'

describe('readReviewWorkflow', () => {
  it('falls back to the database defaults', () => {
    expect(readReviewWorkflow(undefined)).toEqual({
      enabled: false,
      workflow: 'default-scientific-review',
      minReviewers: 1,
    })
    expect(
      readReviewWorkflow({
        reviewWorkflowEnabled: true,
        reviewWorkflowConfig: {},
      }),
    ).toEqual({
      enabled: true,
      workflow: 'default-scientific-review',
      minReviewers: 1,
    })
  })

  it('reads the workflow and reviewer count a workspace pinned', () => {
    expect(
      readReviewWorkflow({
        reviewWorkflowEnabled: true,
        reviewWorkflowConfig: {
          workflow: 'controlled-scientific-review',
          minReviewers: 2,
        },
      }),
    ).toEqual({
      enabled: true,
      workflow: 'controlled-scientific-review',
      minReviewers: 2,
    })
  })

  it('ignores a reviewer count that is not a whole number of at least one', () => {
    for (const minReviewers of [0, -1, 1.5, 'two', null]) {
      expect(
        readReviewWorkflow({
          reviewWorkflowEnabled: true,
          reviewWorkflowConfig: { minReviewers },
        }).minReviewers,
      ).toBe(1)
    }
  })
})
