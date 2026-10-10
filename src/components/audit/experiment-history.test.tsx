import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ExperimentHistoryView } from './experiment-history'
import type { AuditEventWire } from '#/lib/audit-history'

afterEach(cleanup)
function event(overrides: Partial<AuditEventWire>): AuditEventWire {
  return {
    id: 'source',
    sequence: 12,
    createdAt: '2026-09-24T23:32:14Z',
    entityType: 'sheet_instance',
    entityUuid: 'sheet-1',
    operation: 'update',
    recordId: 'record-1',
    projectId: 'project-1',
    actorUserId: 'gareth',
    actorName: 'Gareth P.',
    actorCredentialId: null,
    clientId: 'web-client',
    payload: {
      name: 'Clarification runs',
      changes: { 'Load (L/m²)': { from: 125, to: 150 } },
      reason: 'Transcription error; run sheet says 150',
      sessionId: 'session-a',
    },
    ...overrides,
  }
}

it('selects real captured details and only explicitly linked effects, in workspace time', () => {
  const events = [
    event({}),
    event({
      id: 'linked',
      sequence: 13,
      entityType: 'calculation',
      actorUserId: null,
      actorName: null,
      payload: {
        name: 'Meets criteria',
        sourceEventId: 'source',
        changes: { result: { from: false, to: true } },
      },
    }),
    event({
      id: 'unlinked',
      sequence: 14,
      entityType: 'calculation',
      payload: { name: 'Unrelated calculation' },
    }),
  ]
  render(
    <ExperimentHistoryView
      recordId="record-1"
      identifier="EXP-0142"
      events={events}
      snapshotBefore={15}
      timeZone="Europe/London"
    />,
  )
  expect(screen.getByText('Friday 25 September 2026')).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Inspect audit entry 12: updated Sheet Clarification runs',
    }),
  )
  const details = within(
    screen.getByRole('complementary', { name: 'Entry details' }),
  )
  expect(details.getByText('125')).toBeTruthy()
  expect(details.getByText('150')).toBeTruthy()
  expect(details.getByText('session-a')).toBeTruthy()
  expect(details.getByText('web-client')).toBeTruthy()
  expect(details.getByText('25 Sept 2026, 00:32:14 BST')).toBeTruthy()
  const effects = within(
    details.getByRole('region', { name: 'Knock-on changes' }),
  )
  expect(effects.getByText(/Meets criteria/)).toBeTruthy()
  expect(effects.queryByText(/Unrelated/)).toBeNull()
})

it('counts the selected actor/category and sends exactly that immutable prefix to CSV', () => {
  render(
    <ExperimentHistoryView
      recordId="record-1"
      identifier="EXP-0142"
      events={[
        event({}),
        event({
          id: 'text',
          sequence: 11,
          entityType: 'block',
          actorUserId: 'priya',
          actorName: 'Priya S.',
          payload: { type: 'rich_text' },
        }),
      ]}
      snapshotBefore={13}
      timeZone="Europe/London"
    />,
  )
  expect(screen.getByRole('button', { name: 'all 2' })).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'History actor' }), {
    target: { value: 'priya' },
  })
  expect(screen.getByRole('button', { name: 'all 1' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'text 1' }))
  expect(
    screen
      .getByRole('link', { name: 'Export audit trail' })
      .getAttribute('href'),
  ).toBe(
    '/api/export/record/record-1/audit?category=text&before=13&actor=priya',
  )
  expect(
    screen.queryByRole('button', { name: /Inspect audit entry 12/ }),
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'signatures 0' }))
  expect(screen.getByText('No signatures in this selection.')).toBeTruthy()
})

it('renders a recorded protocol deviation with its frozen and recorded text', () => {
  render(
    <ExperimentHistoryView
      recordId="record-1"
      identifier="EXP-0142"
      events={[
        event({
          id: 'deviation',
          sequence: 21,
          entityType: 'protocol_deviation',
          operation: 'update',
          payload: {
            effect: 'protocol_deviation',
            blockId: 'block-9',
            frozenText: 'Hold at 2-8 C for 14 days.',
            recordedText: 'Hold at 2-8 C for 21 days.',
            changes: {
              text: {
                from: 'Hold at 2-8 C for 14 days.',
                to: 'Hold at 2-8 C for 21 days.',
                label: 'Protocol step text',
              },
            },
          },
        }),
      ]}
      snapshotBefore={22}
      timeZone="Europe/London"
    />,
  )
  fireEvent.click(
    screen.getByRole('button', {
      name: /Inspect audit entry 21/,
    }),
  )
  const details = within(
    screen.getByRole('complementary', { name: 'Entry details' }),
  )
  expect(details.getByText('Protocol step text')).toBeTruthy()
  expect(details.getByText('Hold at 2-8 C for 14 days.')).toBeTruthy()
  expect(details.getByText('Hold at 2-8 C for 21 days.')).toBeTruthy()
})
