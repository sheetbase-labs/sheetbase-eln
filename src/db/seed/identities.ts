/**
 * Stable seed identities. See docs/seeds.md.
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

export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000001'
export const FIXTURE_USER_EMAIL = 'owner@sheetbase.test'

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
} as const
