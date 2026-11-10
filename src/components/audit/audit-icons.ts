/**
 * Icon vocabulary for audit event rows. One module owns how an audit event is
 * illustrated: the operation it records, the entity it happened to, a review
 * decision, or the event kind an `AuditTrail` carries.
 *
 * Each dimension is named by the wire, so the keys are free strings and a
 * vocabulary only has to cover the ones worth a distinct icon; anything else
 * falls back where it is looked up.
 */
import type { IconName } from '#/components/icons'

/** A partial vocabulary: an icon for the names it knows, nothing for the rest. */
export interface AuditIconVocabulary {
  readonly [name: string]: IconName | undefined
}

export const AUDIT_OPERATION_ICONS: AuditIconVocabulary = {
  create: 'gitCommit',
  update: 'history',
  move: 'arrowRightLeft',
  delete: 'fileWarning',
  archive: 'archive',
  restore: 'archiveRestore',
  link: 'link',
  unlink: 'link',
  quarantine: 'fileWarning',
  resolve: 'history',
  reopen: 'history',
  lock: 'lock',
  amend: 'gitCommit',
  revoke: 'key',
}

export const AUDIT_ENTITY_ICONS: AuditIconVocabulary = {
  record: 'protocol',
  file: 'protocol',
  folder: 'folderTree',
  dataset: 'database',
  dataset_version: 'database',
  sheet_instance: 'table',
  sheet_definition: 'template',
  sheet_definition_version: 'template',
  notebook_template: 'template',
  notebook_template_version: 'template',
  review_submission: 'table',
  review_decision: 'table',
  signature: 'edit',
  api_credential: 'key',
  comment: 'comment',
}

export const AUDIT_DECISION_ICONS: AuditIconVocabulary = {
  approve: 'checkCircle',
  reject: 'xCircle',
  request_changes: 'undo',
  withdraw: 'undo',
}

/** Defaults for the typed events `AuditTrail` renders. */
export const AUDIT_TYPE_ICONS: AuditIconVocabulary = {
  created: 'flask',
  uploaded: 'upload',
  'review-requested': 'fileCheck',
  'review-started': 'userCheck',
}
