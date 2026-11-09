/**
 * The objects of this area that are not on the token API, each with the
 * technical reason. Everything else is in `operations.ts` or `api-tables.ts`.
 */
export const WORKSPACE_NOT_EXPOSED: Readonly<Record<string, string>> = {
  accept_invitation:
    'Joining a workspace is the invited person’s own consent, given in the app from the link they were sent; the invitation token is theirs alone.',
  record_cell_conflict:
    'Written by the app’s offline sync when a queued edit meets a newer one, with both authors and times as the device saw them; a caller could make up a conflict in someone else’s name. Conflicts are read on sheet_cell_conflicts and settled with resolve_cell_conflict.',
  analysis_evidence_source:
    'Runs inside freeze_chart and freeze_analysis_block to pin the dataset version an analysis was made from; those calls pin it themselves, and on its own it would only make a stray snapshot.',
  create_file_upload:
    'One step of an upload: POST /api/files (personal tokens with files:write, and the MCP file tools) stores the bytes and then calls it; on its own it would name a file with nothing stored.',
  finalize_file_upload:
    'One step of an upload, called by the file routes once the bytes are stored and checked; tokens upload through POST /api/files.',
  register_file_version:
    'One step of adding a file version, called by the file routes once the new bytes are stored; tokens add versions through the file routes.',
  transition_file_status:
    'The status change behind quarantine_file, restore_file and delete_file (on the API) and the download route’s missing-file check; those are the calls to use.',
  sweep_sample_hold_limits:
    'The scheduled job that moves samples past their hold limit to hold_exceeded across every workspace; it runs as the system, not as a person.',
}
