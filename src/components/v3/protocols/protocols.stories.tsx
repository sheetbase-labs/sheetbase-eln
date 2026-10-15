import type { Meta, StoryObj } from '@storybook/tanstack-react'

import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { PageHeader, Section } from '../ui/layout'
import { ProtocolDocument } from './protocol-document'
import { ProtocolVersionTraining } from './protocol-version-training'

const meta = {
  title: 'Lab/Protocol preparation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Synthetic component fixtures, not seeded approval or training evidence. */
const version: ProtocolVersion = {
  id: '00000000-0000-4000-8000-00000000b702',
  workspace_id: '00000000-0000-4000-8000-00000000b700',
  protocol_record_id: '00000000-0000-4000-8000-00000000b701',
  version: 3,
  status: 'effective',
  effective_at: '2026-09-02T00:00:00Z',
  review_due_at: '2027-09-02T00:00:00Z',
  change_summary: 'Hold parameters clarified.',
  created_by_user_id: 'fixture-author',
  created_at: '2026-08-28T00:00:00Z',
}

export const Document: Story = {
  render: () => (
    <>
      <PageHeader
        title="Harvest clarification"
        meta="Component fixture. Not controlled-version acceptance."
      />
      <div className="mx-auto max-w-[760px] py-4">
        <Section title="Working document">
          <ProtocolDocument
            blocks={[
              {
                id: 'fixture-purpose',
                type: 'rich_text',
                payload: {
                  doc: {
                    type: 'doc',
                    content: [
                      {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Purpose' }],
                      },
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'Clarify the harvest before downstream processing.',
                          },
                        ],
                      },
                      {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Parameters' }],
                      },
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'Flux 100 LMH ±5. Loads 50, 100, and 150 L/m',
                          },
                          {
                            type: 'text',
                            text: '2',
                            marks: [{ type: 'superscript' }],
                          },
                          {
                            type: 'text',
                            text: '. Hold at 2–8 °C for ≤14 days.',
                          },
                        ],
                      },
                      {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Procedure' }],
                      },
                    ],
                  },
                },
              },
              {
                id: 'fixture-step',
                type: 'procedure_step',
                payload: {
                  text: 'Record pressure every 10 L/m².',
                  stepNumber: 1,
                },
              },
              {
                id: 'fixture-criteria',
                type: 'rich_text',
                payload: {
                  doc: {
                    type: 'doc',
                    content: [
                      {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [
                          { type: 'text', text: 'Acceptance criteria' },
                        ],
                      },
                      {
                        type: 'bulletList',
                        content: [
                          {
                            type: 'listItem',
                            content: [
                              {
                                type: 'paragraph',
                                content: [
                                  { type: 'text', text: 'Yield ≥80%.' },
                                ],
                              },
                            ],
                          },
                          {
                            type: 'listItem',
                            content: [
                              {
                                type: 'paragraph',
                                content: [
                                  { type: 'text', text: 'Turbidity ≤20 NTU.' },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ]}
          />
        </Section>
      </div>
    </>
  ),
}

export const EmptyDocument: Story = {
  render: () => <ProtocolDocument blocks={[]} />,
}

export const UnreadableDocument: Story = {
  render: () => (
    <ProtocolDocument
      blocks={[
        { id: 'fixture-invalid', type: 'rich_text', payload: { doc: null } },
      ]}
    />
  ),
}

export const TrainingRequired: Story = {
  render: () => (
    <div className="max-w-[760px]">
      <p className="mb-4 text-label text-fg-muted">
        Synthetic component fixture. No acknowledgement endpoint is called.
      </p>
      <ProtocolVersionTraining
        version={version}
        members={[
          { user_id: 'fixture-sam', name: 'Sam' },
          { user_id: 'fixture-mei', name: 'Mei' },
        ]}
        acknowledgements={[
          {
            protocol_version_id: version.id,
            user_id: 'fixture-mei',
            acknowledged_at: '2026-09-03T00:00:00Z',
          },
        ]}
        currentUserId="fixture-sam"
        acknowledging={false}
        writer
        onAcknowledge={() => {}}
      />
    </div>
  ),
}

export const TrainingFailed: Story = {
  render: () => (
    <div className="max-w-[760px]">
      <ProtocolVersionTraining
        version={version}
        members={[{ user_id: 'fixture-sam', name: 'Sam' }]}
        acknowledgements={[]}
        currentUserId="fixture-sam"
        acknowledging={false}
        writer
        error="The server refused acknowledgement. No acknowledgement was recorded."
        onAcknowledge={() => {}}
      />
    </div>
  ),
}

export const TrainingPending: Story = {
  render: () => (
    <ProtocolVersionTraining
      version={version}
      members={[{ user_id: 'fixture-sam', name: 'Sam' }]}
      acknowledgements={[]}
      currentUserId="fixture-sam"
      acknowledging
      writer
      onAcknowledge={() => {}}
    />
  ),
}

export const TrainingUnavailable: Story = {
  render: () => (
    <ProtocolVersionTraining
      version={{ ...version, status: 'retired' }}
      members={[{ user_id: 'fixture-sam', name: 'Sam' }]}
      acknowledgements={[]}
      currentUserId="fixture-sam"
      acknowledging={false}
      writer
      onAcknowledge={() => {}}
    />
  ),
}
