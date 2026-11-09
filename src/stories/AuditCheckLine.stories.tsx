import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AuditCheckLine } from '#/components/review/audit-check-line'
import { auditVerificationKeys } from '#/lib/audit-verification-status'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * The information icon beside a signed record's heading. Its tooltip carries
 * what the signatures bind to and when the audit trail was last found intact;
 * a failed check stays on the page as a warning. The check is one read, which a
 * story seeds, so the line never claims a check that has not run.
 */
const key = auditVerificationKeys.status

const verified = screenQueryClient({
  data: [
    {
      key,
      value: {
        ok: true,
        checkedAt: '2026-10-21T08:00:00Z',
        entriesChecked: 1280,
        signaturesChecked: 42,
        firstBadRevisionId: null,
      },
    },
  ],
})

const failed = screenQueryClient({
  data: [
    {
      key,
      value: {
        ok: false,
        checkedAt: '2026-10-21T08:00:00Z',
        entriesChecked: 1280,
        signaturesChecked: 42,
        firstBadRevisionId: 'revision-9',
      },
    },
  ],
})

const never = screenQueryClient({ data: [{ key, value: null }] })
const pending = screenQueryClient()

holdRead(pending, key)

const meta = {
  title: 'Review/Audit check line',
  component: AuditCheckLine,
  tags: ['autodocs'],
  args: { note: 'Signatures bind to the revision as it was when signed.' },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="flex w-[480px] max-w-full flex-wrap items-center gap-2">
          <h3 className="m-0 text-body font-semibold">Signatures</h3>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof AuditCheckLine>

export default meta

type Story = StoryObj<typeof meta>

/** The trail was found intact: the tooltip says when. */
export const Verified: Story = { parameters: { client: verified } }

/** The check failed: the warning stays on the page. */
export const Failed: Story = { parameters: { client: failed } }

/** No check has ever run. */
export const NeverChecked: Story = { parameters: { client: never } }

/** The answer is still loading: only the note is offered. */
export const Loading: Story = { parameters: { client: pending } }
