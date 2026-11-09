/**
 * The objects of this area that are not on the token API, each with the
 * technical reason. Everything else in the area is declared in
 * `operations.ts` or `api-tables.ts`.
 */
export const PROJECTS_NOT_EXPOSED: Readonly<Record<string, string>> = {
  change_events:
    'The raw audit log, which can hold session addresses. Read it through audit_events, export_audit_log and event_stream_page, which leave those out and apply who may read admin entries.',
  workspace_change_seq:
    'The counter that numbers audit log entries; the database moves it as each change is written.',
  apply_invitation_project_grants:
    'Runs inside accept_invitation to add the projects an invitation names; it takes the invitation row, so it cannot be called on its own.',
  has_data_access:
    'Whether the caller has data access, asked by the reporting calls themselves; sql_access_ready answers it for a caller.',
  has_settings_access:
    'Whether the caller may open a settings area, asked inside every settings call; settings_access_level answers it for a caller.',
  create_sql_login:
    'Hands out a database password, shown once to the person who makes it in Settings; it is never stored or returned again. Listing and revoking logins are on the API.',
  rotate_sql_login:
    'Hands out a new database password, shown once to the person who rotates it in Settings. Listing and revoking logins are on the API.',
}
