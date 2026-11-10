import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  CheckItemResult,
  ReviewCheckResultWire,
} from '#/lib/review-checks'
import { ReviewCheckResults } from './review-check-results'

afterEach(cleanup)

function result(evidence: CheckItemResult['evidence']): ReviewCheckResultWire {
  return {
    id: 'result-1',
    workspace_id: 'workspace-1',
    record_id: 'record-1',
    revision_id: 'revision-1',
    check_definition_key: 'submission',
    check_definition_version: 3,
    revision_integrity_digest: 'a'.repeat(64),
    check_definition_digest: 'b'.repeat(64),
    input_digest: 'c'.repeat(64),
    overall_status: 'fail',
    pass_count: 0,
    blocking_failure_count: 1,
    warning_failure_count: 0,
    info_failure_count: 0,
    results: [
      {
        key: 'quantity',
        category: 'schema',
        severity: 'blocking',
        label: 'Scientific quantity evidence',
        status: 'fail',
        evidence,
      },
    ],
    run_by_user_id: 'reviewer-1',
    run_session_id: 'review-session',
    run_role: 'reviewer',
    run_at: '2026-11-09T12:00:00Z',
    idempotency_key: 'run-1',
    created_at: '2026-11-09T12:00:00Z',
  }
}

function expand(evidence: CheckItemResult['evidence']) {
  render(<ReviewCheckResults result={result(evidence)} />)
  fireEvent.click(
    screen.getByRole('button', { name: /Scientific quantity evidence/ }),
  )
}

describe('immutable review evidence', () => {
  it('expands native JSON without invoking its String fallback', () => {
    const trace: string[] = []
    expand({
      get toJSON() {
        trace.push('toJSON')

        return () => {
          trace.push('call')

          return { titre: '9.5000E+05', unit: 'TU/mL' }
        }
      },
      toString() {
        throw new Error('must not convert JSON evidence')
      },
    })
    expect(screen.getByText(/9.5000E\+05/)).toBeTruthy()
    expect(screen.getByText(/TU\/mL/)).toBeTruthy()
    expect(trace).toEqual(['toJSON', 'call'])
    expect(
      screen.getByRole('button', { name: /Scientific quantity evidence/ }),
    ).toHaveProperty('ariaExpanded', 'true')
  })

  it('uses the native String fallback for cyclic and bigint evidence', () => {
    const cyclic: CheckItemResult['evidence'] = {
      toString: () => 'Native cyclic evidence',
    }

    cyclic.self = cyclic
    expand(cyclic)
    expect(screen.getByText('Native cyclic evidence')).toBeTruthy()
    cleanup()
    expand({ value: 17n, toString: () => 'Native bigint evidence' })
    expect(screen.getByText('Native bigint evidence')).toBeTruthy()
  })

  it('converts only after a native JSON failure and preserves coercion refusal', () => {
    const trace: string[] = []
    expand({
      toJSON() {
        trace.push('JSON')
        throw new Error('JSON refused')
      },
      toString() {
        trace.push('String')

        return 'Native fallback'
      },
    })
    expect(screen.getByText('Native fallback')).toBeTruthy()
    expect(trace).toEqual(['JSON', 'String'])
    cleanup()
    const refusalTrace: string[] = []
    expect(() =>
      expand({
        toJSON() {
          refusalTrace.push('JSON')
          throw new Error('JSON refused')
        },
        toString() {
          refusalTrace.push('String')
          throw new Error('String refused')
        },
      }),
    ).toThrow('String refused')
    expect(refusalTrace.length).toBeGreaterThan(0)

    for (let index = 0; index < refusalTrace.length; index += 2) {
      expect(refusalTrace.slice(index, index + 2)).toEqual(['JSON', 'String'])
    }
  })
})
