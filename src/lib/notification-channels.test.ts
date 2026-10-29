import { describe, expect, it } from 'vitest'

import {
  channelBody,
  emailMessage,
  eventMessage,
  eventTeamsCard,
  teamsMessageCard,
} from './notification-channels'
import type { PipelineRunNotification } from './notification-channels'

const payload: PipelineRunNotification = {
  schemaVersion: '1',
  eventType: 'pipeline.run.completed',
  eventId: 'ev-1',
  workspaceId: 'ws-1',
  runId: 'run-1',
  definitionVersionId: 'pdv-1',
  result: {
    rowCount: 12,
    outputDatasetId: 'ds-1',
    outputLabel: 'Turbidity results',
  },
}

describe('channelBody', () => {
  it('sends the signed event payload to a plain webhook', () => {
    const body = JSON.parse(channelBody('webhook', payload))
    expect(body.eventType).toBe('pipeline.run.completed')
    expect(body.runId).toBe('run-1')
    // The generic channel sends the payload itself, not a card.
    expect(body['@type']).toBeUndefined()
  })

  it('sends a message card to a Teams channel', () => {
    const body = JSON.parse(channelBody('teams', payload))
    expect(body['@type']).toBe('MessageCard')
    expect(body['@context']).toContain('schema.org')
    expect(body.facts).toEqual(
      expect.arrayContaining([
        { name: 'Run', value: 'run-1' },
        { name: 'Output', value: 'Turbidity results' },
        { name: 'Rows', value: '12' },
      ]),
    )
    // A card is not the event payload.
    expect(body.eventType).toBeUndefined()
  })

  it('falls back to the webhook body for a subscription with no type', () => {
    // Every existing subscription has no type and must keep its behaviour.
    expect(channelBody(null, payload)).toBe(channelBody('webhook', payload))
    expect(channelBody(undefined, payload)).toBe(
      channelBody('webhook', payload),
    )
  })
})

describe('teamsMessageCard', () => {
  it('omits a fact it does not have rather than sending an empty one', () => {
    const card = teamsMessageCard({
      ...payload,
      result: { rowCount: 0 },
    })
    const facts = card.facts as Array<{ name: string; value: string }>
    expect(facts.map((fact) => fact.name)).toEqual(['Run', 'Rows'])
    expect(facts.find((fact) => fact.name === 'Rows')?.value).toBe('0')
  })

  it('names the run in the summary so a notification list is readable', () => {
    expect(teamsMessageCard(payload).summary).toBe('Pipeline run completed')
    expect(
      teamsMessageCard(payload, { title: 'PV stability finished' }).summary,
    ).toBe('PV stability finished')
  })
})

describe('emailMessage', () => {
  it('sends a subject and a plain-text body naming the run and its output', () => {
    expect(emailMessage(payload)).toEqual({
      subject: 'Pipeline run completed',
      body: 'Run run-1 completed.\nOutput: Turbidity results\nRows: 12',
    })
  })

  it('takes a title as the subject when one is given', () => {
    expect(
      emailMessage(payload, { title: 'PV stability finished' }).subject,
    ).toBe('PV stability finished')
  })

  it('omits a line it does not have rather than sending an empty one', () => {
    const body = emailMessage({ ...payload, result: { rowCount: 0 } }).body
    expect(body).toBe('Run run-1 completed.\nRows: 0')
  })
})

describe('event messages for a person or a Teams channel', () => {
  const event = {
    eventType: 'approval.requested',
    createdAt: '2026-10-29T16:00:00Z',
  }

  it('names the event in plain words and links to the app', () => {
    const message = eventMessage(event, 'https://eln.example')
    expect(message.title).toBe('An approval is requested')
    expect(message.body).toContain('When: 2026-10-29 16:00 UTC')
    expect(message.body).toContain('https://eln.example')
    expect(message.body).not.toContain('approval.requested')
  })

  it('builds a Teams card with the same title', () => {
    const card = eventTeamsCard(event, 'https://eln.example')
    expect(card['@type']).toBe('MessageCard')
    expect(card.title).toBe('An approval is requested')
  })
})
