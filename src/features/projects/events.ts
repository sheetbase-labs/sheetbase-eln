/**
 * Webhook, live feed and pipeline events for folders, the audit check and SQL
 * logins. Project and record moves already have catalogue entries
 * (`project.*`, `record.moved`); since this area's migration a record that
 * changes project or folder produces `record.moved`.
 */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

const everywhere = Object.freeze({ webhook: true, sse: true, pipeline: true })

const entry = (
  name: string,
  summary: string,
  producer: EventCatalogueEntry['producer'],
  notes?: string,
): EventCatalogueEntry => {
  const result: EventCatalogueEntry = {
    name,
    family: 'administration',
    summary,
    producer,
    wireName: name,
    status: 'stable',
    introducedIn: 'projects-01',
    consumers: everywhere,
  }

  return notes ? { ...result, notes } : result
}

export const PROJECTS_EVENTS: readonly EventCatalogueEntry[] = Object.freeze([
  entry(
    'folder.created',
    'A folder was made in a project.',
    { entityType: 'folder', operation: 'create' },
    'The payload carries the folder’s `identifier` and `name`; the project is `projectId` on the envelope.',
  ),
  entry('folder.updated', 'A folder was renamed or moved.', {
    entityType: 'folder',
    operation: 'update',
  }),
  entry('folder.deleted', 'A folder was deleted.', {
    entityType: 'folder',
    operation: 'delete',
  }),
  entry(
    'folder.items_moved',
    'Datasets, sheets, analysis views or pipelines were filed in a folder, or taken out of one.',
    { entityType: 'folder', operation: 'move' },
    'The payload lists the `items` (`{ kind, id }`) and how many `moved`. Taken out of every folder, the subject is the workspace.',
  ),
  entry(
    'audit.verified',
    'The audit log and every signed record were checked.',
    { entityType: 'system', operation: 'create' },
    'From the nightly check and from `run_audit_verification`. `ok` is false when an entry or a signature did not hold; `chain` and `signedRevisions` say which.',
  ),
  entry(
    'sql_login.created',
    'A read-only SQL login was made.',
    {
      entityType: 'api_credential',
      operation: 'create',
      when: { key: 'kind', equals: 'sql_login' },
    },
    'The payload names the login and its username, never the password.',
  ),
  entry('sql_login.revoked', 'A read-only SQL login was revoked.', {
    entityType: 'api_credential',
    operation: 'revoke',
    when: { key: 'kind', equals: 'sql_login' },
  }),
])

/** What the event pickers call each event. */
export const PROJECTS_EVENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    'folder.created': 'A folder is made',
    'folder.updated': 'A folder is renamed',
    'folder.deleted': 'A folder is deleted',
    'folder.items_moved': 'Work is filed in a folder',
    'audit.verified': 'The audit log is checked',
    'sql_login.created': 'A SQL login is made',
    'sql_login.revoked': 'A SQL login is revoked',
  })
