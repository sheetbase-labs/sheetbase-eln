import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import type { ColumnPromotion } from '#/lib/schema-evolution'

import { PromoteRejected } from './promote-rejected'
import { SheetPromote } from './sheet-promote'
import type { SheetPromoteLocalField } from './sheet-promote'

afterEach(cleanup)

const INSTANCE = 'inst-1'

const FIELD: SheetPromoteLocalField = {
  fieldId: 'field-1',
  key: 'visual_clarity',
  label: 'Visual clarity',
  logicalType: 'category',
  quantity: null,
}

const DEFINITION = {
  id: 'def-1',
  key: 'ds-0311',
  name: 'DS-0311 Clarification',
  description: null,
  lifecycle: 'published',
  display_id: 'DS-0311',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  created_by_user_id: null,
}

function makeClient(
  options: { promotions?: ColumnPromotion[]; rpcError?: unknown } = {},
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    list: vi.fn(async (resource: string) => {
      if (resource === 'dataset_schema_definitions') return [DEFINITION]
      if (resource === 'column_promotions') return options.promotions ?? []
      return []
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (options.rpcError) throw options.rpcError
      return { ok: true, promotionId: 'promo-1', state: 'pending' }
    }),
  } as unknown as DataClient
  return { client, calls }
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

async function openAndFill(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Promote column…' }))
  const dialog = screen.getByRole('dialog')
  // The dialog names what will be added before anything is requested.
  expect(within(dialog).getByText('visual_clarity')).toBeTruthy()
  expect(within(dialog).getByText('Choice')).toBeTruthy()
  await within(dialog).findByRole('option', { name: DEFINITION.name })
  await user.selectOptions(
    within(dialog).getByRole('combobox', { name: /Dataset Schema Definition/ }),
    DEFINITION.id,
  )
  fireEvent.change(within(dialog).getByLabelText(/Reason/), {
    target: { value: 'Used in every batch' },
  })
  return dialog
}

describe('SheetPromote', () => {
  it('requests the promotion through request_column_promotion, never the direct path', async () => {
    const { client, calls } = makeClient()
    const onSubmitted = vi.fn()
    const user = userEvent.setup()
    renderWithQuery(
      <SheetPromote
        instanceId={INSTANCE}
        field={FIELD}
        client={client}
        onSubmitted={onSubmitted}
      />,
    )

    const dialog = await openAndFill(user)
    await user.click(
      within(dialog).getByRole('button', { name: 'Request promotion' }),
    )

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(calls.map((call) => call.name)).toEqual(['request_column_promotion'])
    expect(calls[0].args).toMatchObject({
      p_instance_id: INSTANCE,
      p_field_id: FIELD.fieldId,
      p_target: 'dataset_schema',
      p_schema_definition_id: DEFINITION.id,
      p_reason: 'Used in every batch',
    })
    expect(calls.some((call) => call.name === 'promote_local_field')).toBe(
      false,
    )
  })

  it('clears the chosen target so a reopened dialog cannot promote into the same dataset again', async () => {
    const { client, calls } = makeClient()
    const user = userEvent.setup()
    renderWithQuery(
      <SheetPromote instanceId={INSTANCE} field={FIELD} client={client} />,
    )

    const dialog = await openAndFill(user)
    await user.click(
      within(dialog).getByRole('button', { name: 'Request promotion' }),
    )
    await waitFor(() =>
      expect(calls.map((call) => call.name)).toEqual([
        'request_column_promotion',
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Promote column…' }))
    const reopened = screen.getByRole('dialog')
    await within(reopened).findByRole('option', { name: DEFINITION.name })
    expect(
      within(reopened).getByRole('combobox', {
        name: /Dataset Schema Definition/,
      }),
    ).toHaveProperty('value', '')
    expect(within(reopened).getByLabelText(/Reason/)).toHaveProperty(
      'value',
      '',
    )
  })

  it('surfaces the server refusal rather than a success when the field is incompatible', async () => {
    const { client, calls } = makeClient({
      rpcError: new DataClientError(
        'SB071',
        'local field values are incompatible with promotion',
        400,
      ),
    })
    const onSubmitted = vi.fn()
    const user = userEvent.setup()
    renderWithQuery(
      <SheetPromote
        instanceId={INSTANCE}
        field={FIELD}
        client={client}
        onSubmitted={onSubmitted}
      />,
    )

    const dialog = await openAndFill(user)
    await user.click(
      within(dialog).getByRole('button', { name: 'Request promotion' }),
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'cannot be promoted',
    )
    expect(onSubmitted).not.toHaveBeenCalled()
    // The refusal leaves the dialog open so its reason stays visible.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(calls.some((call) => call.name === 'promote_local_field')).toBe(
      false,
    )
  })
})

const RETURNED: ColumnPromotion = {
  id: 'promo-1',
  sheet_instance_id: INSTANCE,
  field_id: FIELD.fieldId,
  target: 'dataset_schema',
  schema_definition_id: DEFINITION.id,
  schema_version_id: 'ver-1',
  model_key: null,
  state: 'returned',
  approval_request_id: 'appr-1',
  reason: "Visual clarity isn't a defined scale, so it can't be a GxP field.",
  requested_by_user_id: 'u-1',
  requested_at: '2026-09-24T09:00:00.000Z',
  decided_at: '2026-09-24T10:40:00.000Z',
}

describe('PromoteRejected', () => {
  it("shows the approver's reason and that the column stayed local", async () => {
    const { client } = makeClient({ promotions: [RETURNED] })
    renderWithQuery(
      <PromoteRejected
        instanceId={INSTANCE}
        fieldId={FIELD.fieldId}
        client={client}
      />,
    )

    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain(RETURNED.reason)
    expect(banner.textContent).toMatch(/stays local/)
    // A return changes nothing: the banner must not claim the column moved.
    expect(banner.textContent).not.toMatch(
      /moved|now reads from|is now a dataset|written to the dataset|promoted to the dataset/i,
    )
  })

  it('renders nothing while the promotion is still pending', async () => {
    const { client } = makeClient({
      promotions: [{ ...RETURNED, state: 'pending', reason: null }],
    })
    const { container } = renderWithQuery(
      <PromoteRejected
        instanceId={INSTANCE}
        fieldId={FIELD.fieldId}
        client={client}
      />,
    )

    await waitFor(() =>
      expect(client.list).toHaveBeenCalledWith(
        'column_promotions',
        expect.stringContaining(`sheet_instance_id=eq.${INSTANCE}`),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(container.textContent).toBe('')
  })
})
