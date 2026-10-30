/**
 * Stable seed identities. See docs/development/seeds.md.
 *
 * All seed UUIDs carry a zero prefix so seeded rows are recognisable anywhere,
 * including accidental screenshots and dumps. Range allocation:
 *
 * - `…0001`–`…00ff` minimal test fixtures (FIXTURE_*)
 * - `…0100`–`…01ff` Virus Stability demonstration data (DEMO_*)
 *
 * Tests must never assert against DEMO_* rows; demonstration data is for
 * humans. Tests create their own data or use the minimal fixtures.
 */

import { DEFAULT_DEV_USER_EMAIL, DEFAULT_DEV_USER_ID } from '#/lib/dev-identity'

export const FIXTURE_USER_ID = DEFAULT_DEV_USER_ID
export const FIXTURE_USER_EMAIL = DEFAULT_DEV_USER_EMAIL

export const FIXTURE_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
export const FIXTURE_WORKSPACE_SLUG = 'fixture-workspace'

export const FIXTURE_PROJECT_ID = '00000000-0000-4000-8000-000000000003'
export const FIXTURE_PROJECT_KEY = 'fixture-project'

export const DEMO_VIRUS_STABILITY_PROJECT_ID =
  '00000000-0000-4000-8000-000000000100'
export const DEMO_VIRUS_STABILITY_PROJECT_KEY = 'virus-stability'

// Virus Stability demonstration data (notebook domain, ELN-002). The demo
// reuses the fixture workspace/user so the seeded project and its experiment
// are visible to the fixture owner without a separate membership.
export const DEMO_VIRUS_STABILITY_RECORD_ID =
  '00000000-0000-4000-8000-000000000101'
export const DEMO_VIRUS_STABILITY_RECORD_IDENTIFIER = 'EXP-2025-0001'
export const DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID =
  '00000000-0000-4000-8000-000000000102'
export const DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER = 'PRT-2025-0001'

// Stable block ids so the demo notebook re-seeds idempotently. 0x110–0x11f.
export const DEMO_BLOCK_IDS = {
  objective: '00000000-0000-4000-8000-000000000111',
  materials: '00000000-0000-4000-8000-000000000113',
  design: '00000000-0000-4000-8000-000000000115',
  designTable: '00000000-0000-4000-8000-000000000116',
  results: '00000000-0000-4000-8000-000000000117',
  resultsChart: '00000000-0000-4000-8000-000000000118',
  titerMetric: '00000000-0000-4000-8000-000000000119',
  checks: '00000000-0000-4000-8000-00000000011a',
  callout: '00000000-0000-4000-8000-00000000011b',
  linkedProtocol: '00000000-0000-4000-8000-00000000011c',
  protocolStep1: '00000000-0000-4000-8000-00000000011d',
  protocolStep2: '00000000-0000-4000-8000-00000000011e',
  copiedStep1: '00000000-0000-4000-8000-00000000011f',
  copiedStep2: '00000000-0000-4000-8000-000000000120',
  // CORE-03 Sheet Instance block plus leftover chart placeholder ids.
  // 0x170–0x17f.
  stabilitySheet: '00000000-0000-4000-8000-000000000170',
  stabilityChartFrozen: '00000000-0000-4000-8000-000000000171',
  stabilitySheetInstance: '00000000-0000-4000-8000-000000000172',
  plateMap: '00000000-0000-4000-8000-000000000180',
  // SCI-009: a linked_record block exercises the in-notebook link render path
  // alongside the record_links relation rows. 0x181.
  linkedRecord: '00000000-0000-4000-8000-000000000181',
} as const

export const DEMO_PROTOCOL_REVISION_ID = '00000000-0000-4000-8000-000000000150'

// SCI-001 scientific record fixtures (Virus Stability). Samples and reagents
// are registry records with configurable properties; field definitions are
// seeded for the fixture workspace so the demo records carry realistic
// scientific fields without runtime configuration. 0x120–0x13f.
export const DEMO_SAMPLE_RECORD_ID = '00000000-0000-4000-8000-000000000121'
export const DEMO_SAMPLE_IDENTIFIER = 'SMP-2025-0001'
export const DEMO_ARCHIVED_SAMPLE_RECORD_ID =
  '00000000-0000-4000-8000-000000000122'
export const DEMO_ARCHIVED_SAMPLE_IDENTIFIER = 'SMP-2025-0002'
export const DEMO_REAGENT_RECORD_ID = '00000000-0000-4000-8000-000000000123'
export const DEMO_REAGENT_IDENTIFIER = 'RGT-2025-0001'

// Stable field-definition ids so re-seeds converge idempotently. 0x130–0x14f.
export const DEMO_FIELD_DEFINITION_IDS = {
  protocolVersion: '00000000-0000-4000-8000-000000000130',
  sampleConstruct: '00000000-0000-4000-8000-000000000131',
  sampleBatch: '00000000-0000-4000-8000-000000000132',
  sampleConcentration: '00000000-0000-4000-8000-000000000133',
  sampleStorage: '00000000-0000-4000-8000-000000000134',
  reagentSupplier: '00000000-0000-4000-8000-000000000141',
  reagentCatalogNo: '00000000-0000-4000-8000-000000000142',
  reagentLot: '00000000-0000-4000-8000-000000000143',
  reagentExpiry: '00000000-0000-4000-8000-000000000144',
  reagentQuantity: '00000000-0000-4000-8000-000000000145',
  reagentUnit: '00000000-0000-4000-8000-000000000146',
  reagentStorage: '00000000-0000-4000-8000-000000000147',
  reportProgramme: '00000000-0000-4000-8000-000000000148',
  reportPeriodEnd: '00000000-0000-4000-8000-000000000149',
} as const

// SCI-003 file attachment fixtures (Virus Stability). Four file records
// exercise the lifecycle states: active, quarantined, deleted and missing.
// Each has a 1:1 file_objects row with a deterministic storage key so the
// seed is idempotent and the honest renderings are visible. 0x160–0x16f.
export const DEMO_FILE_IDS = {
  activeRecord: '00000000-0000-4000-8000-000000000160',
  activeObject: '00000000-0000-4000-8000-000000000161',
  activeIdentifier: 'FILE-2025-0001',
  quarantinedRecord: '00000000-0000-4000-8000-000000000162',
  quarantinedObject: '00000000-0000-4000-8000-000000000163',
  quarantinedIdentifier: 'FILE-2025-0002',
  deletedRecord: '00000000-0000-4000-8000-000000000164',
  deletedObject: '00000000-0000-4000-8000-000000000165',
  deletedIdentifier: 'FILE-2025-0003',
  missingRecord: '00000000-0000-4000-8000-000000000166',
  missingObject: '00000000-0000-4000-8000-000000000167',
  missingIdentifier: 'FILE-2025-0004',
  block: '00000000-0000-4000-8000-000000000168',
} as const

// SCI-006 template fixtures (Virus Stability). A validated notebook template
// (Stability Study), a draft notebook template, an archived protocol template,
// and a record instantiated from the validated template with a source-template
// link. 0x190–0x1af.
export const DEMO_TEMPLATE_IDS = {
  // Validated notebook template: Stability Study (ICH)
  notebookTemplateValidated: '00000000-0000-4000-8000-000000000190',
  notebookTemplateValidatedIdentifier: 'NBK-2025-0001',
  notebookTemplateBlock1: '00000000-0000-4000-8000-000000000191',
  notebookTemplateBlock2: '00000000-0000-4000-8000-000000000192',
  notebookTemplateBlock3: '00000000-0000-4000-8000-000000000193',
  // Draft notebook template: Cell Viability Assay
  notebookTemplateDraft: '00000000-0000-4000-8000-000000000194',
  notebookTemplateDraftIdentifier: 'NBK-2025-0002',
  notebookTemplateDraftBlock1: '00000000-0000-4000-8000-000000000195',
  // Archived protocol template: ELISA Protocol
  protocolTemplateArchived: '00000000-0000-4000-8000-000000000196',
  protocolTemplateArchivedIdentifier: 'PRT-2025-0002',
  protocolTemplateArchivedBlock1: '00000000-0000-4000-8000-000000000197',
  // Record instantiated from the validated notebook template
  instantiatedRecord: '00000000-0000-4000-8000-0000000001a0',
  instantiatedRecordIdentifier: 'EXP-2025-0002',
  instantiatedBlock1: '00000000-0000-4000-8000-0000000001a1',
  instantiatedBlock2: '00000000-0000-4000-8000-0000000001a2',
  instantiatedBlock3: '00000000-0000-4000-8000-0000000001a3',
  // Immutable revision of the validated template at instantiation time
  templateRevision: '00000000-0000-4000-8000-0000000001a8',
  // Source-template link from instantiated record to template
  templateLink: '00000000-0000-4000-8000-0000000001a9',
  // SCI-007: submitted revision of the Virus Stability experiment for
  // the locked/historical overview state.
  experimentRevision: '00000000-0000-4000-8000-0000000001b0',
} as const

// DSYS-05 — UI system v3 design seed stable identities. 0x0300–0x0fff.
//
// The design seed reuses these across runs so a reseed converges. IDs that the
// canonical RPCs generate themselves (sheet instances, folders, connectors,
// reports, revisions, submissions, signatures) are matched by their stable
// natural key instead.
export const DESIGN_SESSION_IDS = {
  gareth: 'design-session-gareth',
  priya: 'design-session-priya',
  mei: 'design-session-mei',
  sam: 'design-session-sam',
  tom: 'design-session-tom',
} as const

// API tokens shown by Settings → API and SDK. The tokens table has no create
// RPC (the server issues credentials itself), so the seed writes these rows
// directly with a stable id: one active and unused, one expiring, and one
// already expired.
export const DESIGN_CREDENTIAL_IDS = {
  unused: '00000000-0000-4000-8000-000000000700',
  expiring: '00000000-0000-4000-8000-000000000701',
  expired: '00000000-0000-4000-8000-000000000702',
} as const

// DSYS-05 — the Document-management webhook and its failing delivery history
// (IntegrationDeliveries). Deliveries have no create RPC (the delivery engine
// owns that), so the seed writes them directly with stable ids, like the
// tokens above.
export const DESIGN_WEBHOOK_IDS = {
  subscription: '00000000-0000-4000-8000-000000000730',
  deliveries: [
    '00000000-0000-4000-8000-000000000731',
    '00000000-0000-4000-8000-000000000732',
    '00000000-0000-4000-8000-000000000733',
    '00000000-0000-4000-8000-000000000734',
    '00000000-0000-4000-8000-000000000735',
  ],
} as const
