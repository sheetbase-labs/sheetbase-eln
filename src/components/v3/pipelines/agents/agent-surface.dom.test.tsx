/**
 * Execution policies (PIPE-01) — disabling a policy removes a delegation, so
 * it asks first; and a workspace with no service credential says why the form
 * cannot create one.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentPoliciesPanel } from './agent-surface'
import type { AgentOperationPolicy } from '#/lib/agent-operations'
import type { AgentPolicyCredentialOption } from './agents-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to?: unknown
    children?: React.ReactNode
    className?: string
  }) => (
    <a href={typeof to === 'string' ? to : '#'} className={className}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

function policy(
  overrides: Partial<AgentOperationPolicy> = {},
): AgentOperationPolicy {
  return {
    id: 'p-1',
    name: 'Assay import rows',
    credential_id: 'cred-1',
    target_type: 'dataset',
    target_id: 'ds-1',
    limits: { maxAffectedRows: 100 },
    enabled: true,
    reason: 'Assay import rows',
    signed_at: '2026-09-25T09:00:00Z',
    signed_meaning: 'I approve this delegation',
    ...overrides,
  } as AgentOperationPolicy
}

const credentials: AgentPolicyCredentialOption[] = [
  { id: 'cred-1', name: 'Pipeline worker', displayPrefix: 'sb_live_ab' },
]

describe('AgentPoliciesPanel', () => {
  it('confirms before disabling a delegation', async () => {
    const user = userEvent.setup()
    const onDisable = vi.fn()
    render(
      <AgentPoliciesPanel
        policies={[policy()]}
        credentials={credentials}
        canManage
        onCreate={vi.fn()}
        onDisable={onDisable}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Disable' }))
    // The click opens the confirmation; the delegation is still enabled.
    expect(onDisable).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Disable policy' }))
    await waitFor(() => expect(onDisable).toHaveBeenCalledWith(policy()))
  })

  it('states why the policy form is unavailable without a credential', () => {
    render(
      <AgentPoliciesPanel
        policies={[]}
        credentials={[]}
        canManage
        onCreate={vi.fn()}
        onDisable={vi.fn()}
      />,
    )

    expect(
      screen
        .getByRole('button', { name: 'Create policy' })
        .hasAttribute('disabled'),
    ).toBe(true)
    // The reason is stated, with the route to the surface that creates one.
    const create = screen.getByRole('link', { name: 'Open API and SDK' })
    expect(create.getAttribute('href')).toBe('/settings/api')
  })
})
