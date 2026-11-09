/**
 * Tables of this area that API tokens (and so MCP and the docs) can read.
 * Read with `lab:read`. Personal ones hold one person's own rows (follows,
 * favourites, what they have seen and opened, their notification settings),
 * so a service credential, which has no person, reads none.
 */
import type { LabTable } from '#/lib/lab-api-surface'

export const PROJECTS_LAB_TABLES: Readonly<Record<string, LabTable>> = {
  folder_items: {
    summary:
      'Which folder each dataset, sheet, analysis view and pipeline is filed in. Records name their folder themselves (`records.folder_id`). File things with `move_to_folder`.',
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['folder_id', 'uuid', 1],
      ['object_kind', 'text', 1],
      ['object_id', 'uuid', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 0],
      ['updated_at', 'ts', 0],
    ],
  },
  work_item_follows: {
    summary:
      'The records you follow. Follow and stop with `follow_record` and `unfollow_record`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['record_id', 'uuid', 1],
      ['created_at', 'ts', 0],
    ],
  },
  work_item_views: {
    summary:
      'Inbox items you have seen, by `item_key`. Mark them with `mark_work_items_seen`.',
    personal: true,
    columns: [
      ['user_id', 'text', 1],
      ['workspace_id', 'uuid', 1],
      ['item_key', 'text', 1],
      ['seen_at', 'ts', 0],
    ],
  },
  notification_events: {
    summary:
      'The kinds of event you can be told about, and whether email and phone alerts are on by default.',
    columns: [
      ['event_type', 'text', 1],
      ['source', 'text', 1],
      ['inbox_kinds', 'text[]', 1],
      ['default_email', 'bool', 1],
      ['default_push', 'bool', 1],
    ],
  },
  notification_preferences: {
    summary:
      'How you want to be told about each kind of event. Change them with `save_notification_preference`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['user_id', 'text', 1],
      ['event_type', 'text', 1],
      ['in_app', 'bool', 1],
      ['email', 'bool', 1],
      ['digest', 'bool', 1],
      ['push', 'bool', 0],
      ['created_at', 'ts', 0],
      ['updated_at', 'ts', 0],
    ],
  },
  recently_viewed: {
    summary: 'What you opened lately. Add to it with `record_recent_view`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['object_kind', 'text', 1],
      ['object_id', 'uuid', 1],
      ['viewed_at', 'ts', 0],
    ],
  },
  user_favourites: {
    summary: 'What you pinned. Pin and unpin with `set_record_favourite`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['object_kind', 'text', 1],
      ['object_id', 'uuid', 1],
      ['created_at', 'ts', 0],
    ],
  },
  trail_evidence: {
    summary:
      'Steps of a record’s history kept as evidence, with a note. Keep one with `save_trail_evidence`; kept evidence never changes.',
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['steps', 'json', 1],
      ['note', 'text', 0],
      ['saved_by_user_id', 'text', 0],
      ['created_at', 'ts', 0],
    ],
  },
}
