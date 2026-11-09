/**
 * Webhook, live feed and pipeline events for the workspace set-up, join
 * domains and the regulated-lab switch. Each is a `workspace_settings` change
 * told apart by its `effect`.
 */
import { WEBHOOK_SSE_PIPELINE } from '../define'
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

const entry = (
  name: string,
  summary: string,
  effect: string,
  notes: string,
): EventCatalogueEntry => ({
  name,
  family: 'administration',
  summary,
  producer: {
    entityType: 'workspace_settings',
    operation: 'update',
    when: { key: 'effect', equals: effect },
  },
  wireName: name,
  status: 'stable',
  introducedIn: 'workspace-01',
  consumers: WEBHOOK_SSE_PIPELINE,
  notes,
})

export const WORKSPACE_EVENTS: readonly EventCatalogueEntry[] = Object.freeze([
  entry(
    'workspace.setup.completed',
    'The workspace was set up.',
    'setup_completed',
    '`starterTables` lists the starter tables that were added.',
  ),
  entry(
    'workspace.join_domains.changed',
    'The email domains whose people can join changed.',
    'join_domains',
    'The payload carries `domains` and the `role` people join as.',
  ),
  entry(
    'workspace.regulated_lab.changed',
    'The regulated-lab rules were turned on or off.',
    'regulated_lab',
    '`regulatedLab` is true when the rules are on.',
  ),
])

/** What the event pickers call each event. */
export const WORKSPACE_EVENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    'workspace.setup.completed': 'The workspace is set up',
    'workspace.join_domains.changed': 'Join domains change',
    'workspace.regulated_lab.changed': 'Regulated-lab rules are switched',
  })
