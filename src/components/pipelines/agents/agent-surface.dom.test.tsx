/**
 * Execution policies (PIPE-01) — disabling a policy removes a delegation, so
 * it asks first; and a workspace with no service credential says why the form
 * cannot create one.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentPoliciesPanel, AgentWorkflowsPanel } from './agent-surface'
import type { AgentOperationPolicy } from '#/lib/agent-operations'
import type { AgentWorkflow } from '#/lib/agent-workflows'
import type { AgentPolicyCredentialOption } from './agents-data'

afterEach(cleanup)

function policy(
  overrides: Partial<AgentOperationPolicy> = {},
): AgentOperationPolicy {
  return {
    id: 'p-1',
    workspace_id: 'workspace-1',
    operation_kind: 'dataset_rows.commit',
    name: 'Assay import rows',
    credential_id: 'cred-1',
    target_type: 'dataset',
    target_id: 'ds-1',
    limits: { maxAffectedRows: 100 },
    enabled: true,
    reason: 'Assay import rows',
    signed_at: '2026-09-25T09:00:00Z',
    signed_meaning: 'I approve this delegation',
    signed_by_user_id: 'user-1',
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-1',
    created_at: '2026-09-25T09:00:00Z',
    updated_at: '2026-09-25T09:00:00Z',
    ...overrides,
  }
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

  it('states why the policy form is unavailable without a credential', async () => {
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <AgentPoliciesPanel
            policies={[]}
            credentials={[]}
            canManage
            onCreate={vi.fn()}
            onDisable={vi.fn()}
          />
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(<RouterProvider router={router} />)

    await screen.findByRole('button', { name: 'Create policy' })

    expect(
      screen
        .getByRole('button', { name: 'Create policy' })
        .hasAttribute('disabled'),
    ).toBe(true)
    // The reason is stated, with the route to the surface that creates one.
    const create = screen.getByRole('link', { name: 'Open API and SDK' })
    expect(create.getAttribute('href')).toBe('/settings/account/api')
  })

  it('keeps bounds and signature fields required and submits the selected target', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <AgentPoliciesPanel
        policies={[]}
        credentials={credentials}
        canManage
        onCreate={onCreate}
        onDisable={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Create the first policy' }),
    )
    const name = screen.getByRole('textbox', { name: 'Policy name' })
    expect(document.activeElement).toBe(name)
    await user.type(name, '  Assay import  ')
    await user.type(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      '  Import reviewed  ',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Target' }),
      'workspace',
    )
    expect(
      screen
        .getByRole('textbox', { name: 'Target id' })
        .hasAttribute('disabled'),
    ).toBe(true)
    const limit = screen.getByRole('spinbutton', { name: 'Max rows' })
    await user.clear(limit)
    await user.type(limit, '1001')
    expect(
      screen
        .getByRole('button', { name: 'Create policy' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.clear(limit)
    await user.type(limit, '100')
    const meaning = screen.getByRole('textbox', { name: /^Signature meaning/ })
    await user.clear(meaning)
    expect(
      screen
        .getByRole('button', { name: 'Create policy' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.type(meaning, 'I approve this delegation')
    await user.click(screen.getByRole('button', { name: 'Create policy' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Assay import',
      credentialId: 'cred-1',
      targetType: 'workspace',
      targetId: null,
      maxAffectedRows: 100,
      reason: 'Import reviewed',
      meaning: 'I approve this delegation',
    })
    expect(
      screen
        .getByRole('button', { name: 'Create policy' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('cancels disabling without removing the delegation', async () => {
    const user = userEvent.setup()
    const onDisable = vi.fn()
    render(
      <AgentPoliciesPanel
        policies={[policy({ limits: { max_affected_rows: 25 } })]}
        credentials={credentials}
        canManage
        onCreate={vi.fn()}
        onDisable={onDisable}
      />,
    )

    expect(screen.getByRole('cell', { name: '25' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Disable' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDisable).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })
})

describe('AgentWorkflowsPanel', () => {
  it('resumes the exact workflow and resets its required cancellation reason on selection', async () => {
    const user = userEvent.setup()

    const first: AgentWorkflow = {
      id: 'workflow-1',
      workspace_id: 'workspace-1',
      goal: 'Review assay',
      status: 'paused',
      revision: 1,
      plan: { formatVersion: 1, steps: [] },
      plan_digest: 'plan-digest',
      provenance: {
        agentId: 'agent-1',
        tool: { name: 'assay' },
        model: { provider: 'local', name: 'test' },
        invocationId: 'invocation-1',
      },
      idempotency_key: 'workflow-1',
      max_operations: 10,
      max_tokens: 100,
      max_cost_microusd: 100,
      used_operations: 0,
      used_tokens: 0,
      used_cost_microusd: 0,
      current_step: 0,
      created_by_user_id: 'user-1',
      created_by_credential_id: null,
      cancelled_by_user_id: null,
      cancelled_by_credential_id: null,
      cancelled_at: null,
      cancellation_reason: null,
      completed_at: null,
      created_at: '2026-09-25T09:00:00Z',
      updated_at: '2026-09-25T09:00:00Z',
    }

    const second: AgentWorkflow = {
      ...first,
      id: 'workflow-2',
      goal: 'Review second assay',
    }

    const onResume = vi.fn()
    const onCancel = vi.fn()

    const props = {
      workflows: [first, second],
      steps: [],
      events: [],
      proposals: [],
      selectedId: first.id,
      onSelect: vi.fn(),
      onAdvance: vi.fn(),
      onResume,
      onCancel,
      onInspectProposal: vi.fn(),
      pendingAction: null,
    } satisfies React.ComponentProps<typeof AgentWorkflowsPanel>

    const view = render(<AgentWorkflowsPanel {...props} />)

    await user.click(screen.getByRole('button', { name: 'Resume exact step' }))
    expect(onResume).toHaveBeenCalledWith(first)
    expect(
      screen
        .getByRole('button', { name: 'Cancel workflow' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.type(
      screen.getByRole('textbox', { name: 'Workflow cancellation reason' }),
      '  Stop assay  ',
    )
    await user.click(screen.getByRole('button', { name: 'Cancel workflow' }))
    expect(onCancel).toHaveBeenCalledWith(first, '  Stop assay  ')
    view.rerender(<AgentWorkflowsPanel {...props} selectedId={second.id} />)
    expect(
      screen.getByRole('textbox', { name: 'Workflow cancellation reason' }),
    ).toHaveProperty('value', '')
    expect(
      screen
        .getByRole('button', { name: 'Cancel workflow' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
