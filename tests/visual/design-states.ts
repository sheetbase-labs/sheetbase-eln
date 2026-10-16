/**
 * Design screen registry for the visual parity suite (DSYS-05/06).
 *
 * `DESIGN_SCREEN_SIZES` lists every vendored design screen and its frame size
 * (from canvas.json). `DESIGN_STATES` maps a screen + theme to the route, the
 * seeded user and the state actions that reproduce it; the spec drives each
 * entry and compares it with the DSYS-01 render.
 *
 * Unmapped screens are documented in `DESIGN_PENDING`, not silently skipped.
 * Pending screens fail coverage. Every board must compare in both themes
 * before DSYS-06 can pass.
 */
export interface DesignState {
  /** Design screen name, e.g. "Main" (matches the rendered PNG stem). */
  screen: string
  /** Route that should reproduce the screen, using design display IDs. */
  route: string
  /** Seeded user to sign in as (a key of `DESIGN_USER_IDS`). */
  user: string
  theme: 'light' | 'dark'
  /** Frame size; taken from `DESIGN_SCREEN_SIZES` for the screen. */
  size: { width: number; height: number }
  /** How to drive the route into the screen's state. */
  state?: DesignStateSpec
  /**
   * Historical mismatch measurement for diagnosis only. This never changes
   * the expected result, tolerance or whether the comparison runs.
   */
  historicalMismatch?: {
    /** Latest measured diff, "ratio (pixels)" at the 0.001 gate. */
    ratio: string
    /** Root causes behind the mismatch (see DESIGN_CAUSES). */
    causes: readonly DesignCauseId[]
    /** Human-readable annotation for the test report. */
    text: string
  }
}

/**
 * The states the driver can reach. These are the states the design screens
 * show: the plain screen, a screen with no data, a screen whose data request
 * failed or has not resolved, a screen with no network, a save conflict, an
 * open dialog, or a specific seeded record.
 */
export type DesignStateSpec =
  | { kind: 'default' }
  | { kind: 'record'; identifier: string }
  | { kind: 'selected-row'; identifier: string; trigger: string }
  | { kind: 'dialog'; trigger: string }
  | { kind: 'scenario' }
  | { kind: 'signed-out' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'conflict' }

/** Root-cause ids shared by the mapped screens and their annotations. */
export type DesignCauseId = 1 | 2 | 3 | 4

/**
 * Root causes behind the current mismatches. Each mapped comparison
 * names the causes that apply, so the expected-failure annotations stay
 * actionable and this is the one place to edit when a cause is fixed.
 */
export const DESIGN_CAUSES: Record<DesignCauseId, string> = {
  1: 'body font cascade: the package :root --font-sans beat the ELN @theme, so app chrome rendered Instrument Sans, not the design Inter (fixed in src/styles.css in this pass)',
  2: 'shell chrome: RESOLVED in this pass — the topbar New is a filled primary button (component CSS layered below app utilities), the trailing bell shows its unread dot (shell now loads api.my_notifications), the pinned projects rail renders three rows (shell now loads api.user_favourites), and the Datasets badge counts distinct datasets. The remaining Inbox (9 vs 8) and Pipelines (2 failed vs 1) counts are a seed discrepancy, counted under cause 3',
  3: 'seeded content: the screen does not show the rows/fields the design screen shows (DSYS-05 seed gap)',
  4: 'route contract: app routes resolved UUIDs only — RESOLVED app-side (route beforeLoad resolves the design display ID and redirects), so parity now navigates raw design IDs and no screen lists this cause',
}

export const DESIGN_SCREEN_SIZES: Record<
  string,
  { width: number; height: number }
> = {
  Analysis: { width: 1440, height: 1000 },
  AnalysisEmpty: { width: 1440, height: 640 },
  AuditLog: { width: 1440, height: 900 },
  ClientPortal: { width: 1440, height: 900 },
  DatasetCompare: { width: 1440, height: 900 },
  DatasetExplorer: { width: 1440, height: 1000 },
  DatasetSnapshots: { width: 1440, height: 900 },
  DatasetsError: { width: 1440, height: 640 },
  DatasetsList: { width: 1440, height: 900 },
  DialogsCreate: { width: 1440, height: 820 },
  DialogsRecord: { width: 1440, height: 1020 },
  EvidenceCompare: { width: 1440, height: 900 },
  EvidencePhone: { width: 390, height: 844 },
  ExpDatasets: { width: 1440, height: 1000 },
  ExpFiles: { width: 1440, height: 900 },
  ExpHistory: { width: 1440, height: 1000 },
  ExpOverview: { width: 1440, height: 1000 },
  ExpResults: { width: 1440, height: 1000 },
  ExpSamples: { width: 1440, height: 900 },
  ExperimentsList: { width: 1440, height: 900 },
  ExperimentsLoading: { width: 1440, height: 760 },
  FocusOrder: { width: 1440, height: 760 },
  FolderMove: { width: 1440, height: 900 },
  HelpRecords: { width: 1440, height: 1000 },
  HomeBench: { width: 1440, height: 900 },
  HomeFirstRun: { width: 1440, height: 900 },
  HomeTriage: { width: 1440, height: 900 },
  ImportFailed: { width: 1440, height: 760 },
  ImportMap: { width: 1440, height: 900 },
  ImportUpload: { width: 1440, height: 820 },
  InboxEmpty: { width: 1440, height: 900 },
  IntegrationConnect: { width: 1440, height: 1000 },
  IntegrationDeliveries: { width: 1440, height: 900 },
  Main: { width: 1440, height: 900 },
  MaterialsList: { width: 1440, height: 900 },
  ModelFields: { width: 1440, height: 900 },
  ModelRecords: { width: 1440, height: 900 },
  ModelVersions: { width: 1440, height: 900 },
  NbConflict: { width: 1440, height: 1000 },
  NbEditing: { width: 1440, height: 1100 },
  NbLoading: { width: 1440, height: 900 },
  NbNew: { width: 1440, height: 1300 },
  NbOffline: { width: 1440, height: 1000 },
  NbSigned: { width: 1440, height: 1300 },
  NbViewer: { width: 1440, height: 1000 },
  NewExperiment: { width: 1440, height: 900 },
  Notebook: { width: 1440, height: 1840 },
  NotebookLaptop: { width: 1024, height: 760 },
  NotebookTablet: { width: 834, height: 1112 },
  Panels: { width: 1440, height: 1860 },
  PhoneHome: { width: 390, height: 844 },
  PhoneInbox: { width: 390, height: 844 },
  PhoneReading: { width: 390, height: 844 },
  PhoneSample: { width: 390, height: 844 },
  PhoneScan: { width: 390, height: 844 },
  PhoneWithdraw: { width: 390, height: 844 },
  PipelineEditor: { width: 1440, height: 1000 },
  PipelineRun: { width: 1440, height: 1000 },
  PipelineRunFailed: { width: 1440, height: 900 },
  PipelineRunWaiting: { width: 1440, height: 900 },
  PipelineRuns: { width: 1440, height: 1000 },
  PipelineTriggers: { width: 1440, height: 1080 },
  PipelinesList: { width: 1440, height: 900 },
  ProjectAmbr: { width: 1440, height: 1000 },
  ProjectDetail: { width: 1440, height: 1000 },
  ProjectFiles: { width: 1440, height: 1000 },
  ProjectFolders: { width: 1440, height: 900 },
  ProjectLVV: { width: 1440, height: 1000 },
  ProjectMembers: { width: 1440, height: 1000 },
  ProjectSettings: { width: 1440, height: 1000 },
  Projects: { width: 1440, height: 900 },
  ProjectsEmpty: { width: 1440, height: 900 },
  ProjectsError: { width: 1440, height: 900 },
  ProjectsNoResults: { width: 1440, height: 900 },
  ProjectsTablet: { width: 834, height: 1112 },
  PromoteRejected: { width: 1440, height: 1000 },
  ProtocolDetail: { width: 1440, height: 1000 },
  ProtocolsList: { width: 1440, height: 900 },
  RecordDetail: { width: 1440, height: 1000 },
  RecordInstrument: { width: 1440, height: 900 },
  RecordNew: { width: 1440, height: 900 },
  RecordPhone: { width: 390, height: 844 },
  ReviewApproved: { width: 1440, height: 1180 },
  ReviewRecord: { width: 1440, height: 1000 },
  ReviewReturned: { width: 1440, height: 1000 },
  ReviewSign: { width: 1440, height: 1000 },
  SampleConsumed: { width: 1440, height: 560 },
  SampleDetail: { width: 1440, height: 1000 },
  SampleExpired: { width: 1440, height: 560 },
  SampleHistory: { width: 1440, height: 1000 },
  SampleLineage: { width: 1440, height: 1000 },
  SampleMeasurements: { width: 1440, height: 1000 },
  SampleQuarantine: { width: 1440, height: 560 },
  SampleUsage: { width: 1440, height: 1000 },
  SamplesEmpty: { width: 1440, height: 640 },
  SamplesList: { width: 1440, height: 900 },
  ScheduleEmpty: { width: 1440, height: 900 },
  SchemaEditor: { width: 1440, height: 1000 },
  SchemaPending: { width: 1440, height: 640 },
  SchemasList: { width: 1440, height: 900 },
  SearchEmpty: { width: 1440, height: 560 },
  SearchPalette: { width: 1440, height: 900 },
  SearchResults: { width: 1440, height: 1000 },
  SettingsAccess: { width: 1440, height: 900 },
  SettingsApi: { width: 1440, height: 900 },
  SettingsGeneral: { width: 1440, height: 900 },
  SettingsInstruments: { width: 1440, height: 900 },
  SettingsIntegrations: { width: 1440, height: 1000 },
  SettingsMembers: { width: 1440, height: 900 },
  SettingsNotifications: { width: 1440, height: 900 },
  SettingsProfile: { width: 1440, height: 1000 },
  SettingsSignature: { width: 1440, height: 900 },
  SheetEmpty: { width: 1440, height: 900 },
  SheetPromote: { width: 1440, height: 1000 },
  SheetTablet: { width: 834, height: 1112 },
  SheetWorking: { width: 1440, height: 1000 },
  Shortcuts: { width: 1440, height: 900 },
  SignedOut: { width: 1440, height: 900 },
  SnapshotRemoved: { width: 1440, height: 900 },
  SnapshotsLaptop: { width: 1024, height: 760 },
  States: { width: 1440, height: 1390 },
  TemplateEditor: { width: 1440, height: 1000 },
  TemplateUpdate: { width: 1440, height: 900 },
  TemplatesList: { width: 1440, height: 900 },
  TokenCreate: { width: 1440, height: 900 },
  TokenExpired: { width: 1440, height: 900 },
}

/** The design seed's fixed clock (DSYS-05.1); parity freezes the browser to it. */
export const DESIGN_CLOCK = new Date('2026-09-25T09:40:00+01:00')

/**
 * Root causes per mapped screen (see DESIGN_CAUSES) — only the causes that
 * still apply. Cause 1 (font cascade), cause 2 (shell chrome) and cause 4
 * (display-ID routing) are fixed, so no screen lists them. The original
 * tranche lists seeded content (cause 3). HelpRecords passes the original
 * full-frame gate in both themes and has no expected-failure annotation.
 */
const CAUSE_BY_SCREEN: Record<string, readonly DesignCauseId[]> = {
  Main: [3],
  HelpRecords: [],
  ClientPortal: [3],
  Projects: [3],
  ProjectDetail: [3],
  ProjectAmbr: [3],
  ProjectLVV: [3],
  ProjectFiles: [3],
  ProjectMembers: [3],
  ProjectSettings: [3],
  ExperimentsList: [3],
  ExpOverview: [3],
  ExpSamples: [3],
  ExpDatasets: [3],
  ExpResults: [3],
  ExpFiles: [3],
  ExpHistory: [3],
  ReviewRecord: [3],
  SheetWorking: [3],
  SamplesList: [3],
  SampleDetail: [3],
  SampleLineage: [3],
  SampleUsage: [3],
  SampleConsumed: [3],
  DatasetsList: [3],
  DatasetExplorer: [3],
  DatasetSnapshots: [3],
  DatasetCompare: [3],
  RecordDetail: [3],
  RecordInstrument: [3],
  PipelineRuns: [3],
  PipelineRun: [3],
  PipelineRunFailed: [3],
  SettingsGeneral: [3],
  SettingsIntegrations: [3],
  IntegrationDeliveries: [3],
}

/**
 * Latest measured diff per mapped screen, per theme: "ratio (pixels)" against
 * the 0.001 gate, measured 2026-10-04 with the font-cascade, display-ID
 * routing and shell-chrome fixes applied. Refresh these when re-running the
 * suite; they are reported in each annotation.
 */
const MEASURED_BY_SCREEN: Record<string, { light: string; dark: string }> = {
  Main: { light: '0.04 (46888 px)', dark: '0.04 (45687 px)' },
  HelpRecords: {
    light: '0.000486806 (701 px)',
    dark: '0.000477083 (687 px)',
  },
  ClientPortal: { light: '0.02 (15692 px)', dark: '0.02 (14906 px)' },
  Projects: { light: '0.04 (41743 px)', dark: '0.04 (40204 px)' },
  ProjectDetail: { light: '0.03 (35525 px)', dark: '0.03 (34308 px)' },
  ProjectAmbr: { light: '0.03 (31098 px)', dark: '0.03 (29839 px)' },
  ProjectLVV: { light: '0.03 (30604 px)', dark: '0.03 (29385 px)' },
  ProjectFiles: { light: '0.04 (51845 px)', dark: '0.02 (27047 px)' },
  ProjectMembers: { light: '0.03 (33368 px)', dark: '0.03 (32965 px)' },
  ProjectSettings: { light: '0.03 (33610 px)', dark: '0.03 (33498 px)' },
  ExperimentsList: { light: '0.04 (44337 px)', dark: '0.04 (42421 px)' },
  ExpOverview: { light: '0.03 (37920 px)', dark: '0.03 (37084 px)' },
  ExpSamples: { light: '0.03 (30765 px)', dark: '0.03 (30416 px)' },
  ExpDatasets: { light: '0.03 (31060 px)', dark: '0.03 (30814 px)' },
  ExpResults: { light: '0.02 (28218 px)', dark: '0.02 (27309 px)' },
  ExpFiles: { light: '0.03 (26078 px)', dark: '0.02 (25242 px)' },
  ExpHistory: { light: '0.03 (31112 px)', dark: '0.03 (30772 px)' },
  ReviewRecord: { light: '0.04 (54407 px)', dark: '0.04 (53389 px)' },
  SheetWorking: { light: '0.03 (29550 px)', dark: '0.02 (28504 px)' },
  SamplesList: { light: '0.03 (33168 px)', dark: '0.03 (32098 px)' },
  SampleDetail: { light: '0.02 (24778 px)', dark: '0.02 (24041 px)' },
  SampleLineage: { light: '0.02 (22298 px)', dark: '0.02 (21641 px)' },
  SampleUsage: { light: '0.03 (30473 px)', dark: '0.03 (30060 px)' },
  SampleConsumed: { light: '0.02 (16013 px)', dark: '0.02 (15570 px)' },
  DatasetsList: { light: '0.02 (25637 px)', dark: '0.02 (24813 px)' },
  DatasetExplorer: { light: '0.03 (38078 px)', dark: '0.03 (36760 px)' },
  DatasetSnapshots: { light: '0.04 (41607 px)', dark: '0.04 (39916 px)' },
  DatasetCompare: { light: '0.02 (18031 px)', dark: '0.02 (17190 px)' },
  RecordDetail: { light: '0.03 (33055 px)', dark: '0.03 (32310 px)' },
  RecordInstrument: { light: '0.02 (24050 px)', dark: '0.02 (23712 px)' },
  PipelineRuns: { light: '0.02 (21080 px)', dark: '0.02 (20301 px)' },
  PipelineRun: { light: '0.02 (19630 px)', dark: '0.02 (19308 px)' },
  PipelineRunFailed: { light: '0.02 (19075 px)', dark: '0.02 (18755 px)' },
  SettingsGeneral: { light: '0.03 (30224 px)', dark: '0.03 (29264 px)' },
  SettingsIntegrations: { light: '0.02 (23694 px)', dark: '0.02 (22779 px)' },
  IntegrationDeliveries: { light: '0.02 (19503 px)', dark: '0.02 (18960 px)' },
}

/** One screen and theme, with the route/user/state that reach it. */
interface MappedScreen {
  screen: string
  route: string
  user?: string
  state?: DesignStateSpec
}

/** Expand a screen list into both themes with the frame size from the canvas. */
function bothThemes(screens: readonly MappedScreen[]): DesignState[] {
  const themes = ['light', 'dark'] as const
  return screens.flatMap(({ screen, route, user = 'gareth', state }) => {
    const size = DESIGN_SCREEN_SIZES[screen]
    if (!size) throw new Error(`Unknown design screen "${screen}"`)
    const causes = CAUSE_BY_SCREEN[screen] ?? []
    const measured = MEASURED_BY_SCREEN[screen]
    const causeText = causes
      .map((id) => `${id}) ${DESIGN_CAUSES[id]}`)
      .join('; ')
    return themes.map((theme) => ({
      screen,
      route,
      user,
      theme,
      size,
      state,
      historicalMismatch:
        causes.length && measured
          ? {
              ratio: measured[theme],
              causes,
              text: `Historical measurement (2026-10-04): ${measured[theme]} against the 0.001 gate. Causes: ${causeText}`,
            }
          : undefined,
    }))
  })
}

const rec = (identifier: string): DesignStateSpec => ({
  kind: 'record',
  identifier,
})

/**
 * The first tranche: every screen whose route exists and whose seeded record
 * (DSYS-05) is in place. Each of these is a real comparison; a screen moves
 * here from `DESIGN_PENDING` only when it can be driven and compared.
 */
export const DESIGN_STATES: DesignState[] = bothThemes([
  { screen: 'Main', route: '/' },
  { screen: 'HelpRecords', route: '/help/records' },
  {
    screen: 'SignedOut',
    route: '/help/records',
    state: { kind: 'signed-out' },
  },
  { screen: 'ReviewSign', route: '/review', state: { kind: 'scenario' } },
  {
    screen: 'SettingsSignature',
    route: '/settings/signatures',
    user: 'sam',
    state: { kind: 'scenario' },
  },
  {
    screen: 'HomeFirstRun',
    route: '/',
    user: 'firstRunEditor',
    state: { kind: 'scenario' },
  },
  {
    screen: 'Shortcuts',
    route: '/help/shortcuts',
    state: { kind: 'dialog', trigger: 'Show keyboard shortcuts' },
  },
  { screen: 'ClientPortal', route: '/client-portal', user: 'clientAna' },
  {
    screen: 'Projects',
    route: '/projects',
    state: {
      kind: 'selected-row',
      identifier: 'PRJ-0217',
      trigger: 'Quick view of AAV9 process transfer',
    },
  },
  { screen: 'ProjectsTablet', route: '/projects' },
  {
    screen: 'ProjectDetail',
    route: '/projects/PRJ-0217',
    state: rec('PRJ-0217'),
  },
  {
    screen: 'ProjectAmbr',
    route: '/projects/PRJ-0205',
    state: rec('PRJ-0205'),
  },
  { screen: 'ProjectLVV', route: '/projects/PRJ-0214', state: rec('PRJ-0214') },
  {
    screen: 'ProjectFiles',
    route: '/projects/PRJ-0217/folders',
    state: rec('PRJ-0217'),
  },
  {
    screen: 'ProjectMembers',
    route: '/projects/PRJ-0217/members',
    state: rec('PRJ-0217'),
  },
  {
    screen: 'ProjectSettings',
    route: '/projects/PRJ-0217/settings',
    state: rec('PRJ-0217'),
  },
  { screen: 'ExperimentsList', route: '/experiments' },
  {
    screen: 'ExpOverview',
    route: '/experiments/EXP-0142/overview',
    state: rec('EXP-0142'),
  },
  {
    screen: 'ExpSamples',
    route: '/experiments/EXP-0142/samples',
    state: rec('EXP-0142'),
  },
  {
    screen: 'ExpDatasets',
    route: '/experiments/EXP-0142/datasets',
    state: rec('EXP-0142'),
  },
  {
    screen: 'ExpResults',
    route: '/experiments/EXP-0142/results',
    state: rec('EXP-0142'),
  },
  {
    screen: 'ExpFiles',
    route: '/experiments/EXP-0142/files',
    state: rec('EXP-0142'),
  },
  {
    screen: 'ExpHistory',
    route: '/experiments/EXP-0142/history',
    state: rec('EXP-0142'),
  },
  { screen: 'ReviewRecord', route: '/review/EXP-0138', state: rec('EXP-0138') },
  { screen: 'SheetWorking', route: '/sheets/SHT-0019', state: rec('SHT-0019') },
  { screen: 'SamplesList', route: '/samples' },
  {
    screen: 'MaterialsList',
    route: '/materials',
    historicalMismatch: {
      ratio: '0.02 (24346 px) at the 0.001 gate',
      causes: [3],
      text: 'The board matches the canvas on content: the nine design rows in order with their titles, lots, per-lot stock and storage locations, MAT-0402 quarantined, MAT-0355 expired, no stale lots, Status reading lot standing (Expires 1 Oct, Released Mar 2027), the inspector stating the whole lot block (supplier with catalogue number, Received, Released by, Certificate as a real file link, Stock of total, expiry with days), Used in (EXP-0142, 1 unit, 23 Sep) from a seeded record link, and the action row (Register replacement lot with its dialog, Quarantine), both backed by RPCs. The column positions now agree within a few pixels because the seed uses the design supplier labels, which every canvas uses. What remains: the header counts (412 materials, 356 in stock), which cannot be reproduced together with these rows - see the work log - and the design impact sentence, which needs an impact analysis rather than static copy.',
    },
  },
  {
    screen: 'SampleDetail',
    route: '/samples/SMP-2231',
    state: rec('SMP-2231'),
  },
  {
    screen: 'SampleLineage',
    route: '/samples/SMP-2231/lineage',
    state: rec('SMP-2231'),
  },
  {
    screen: 'SampleUsage',
    route: '/samples/SMP-2231/usage',
    state: rec('SMP-2231'),
  },
  {
    screen: 'SampleConsumed',
    route: '/samples/SMP-2210',
    state: rec('SMP-2210'),
  },
  { screen: 'DatasetsList', route: '/datasets' },
  {
    screen: 'DatasetExplorer',
    route: '/datasets/DS-0298/rows',
    state: rec('DS-0298'),
  },
  {
    screen: 'DatasetSnapshots',
    route: '/datasets/DS-0311/snapshots',
    state: rec('DS-0311'),
  },
  {
    screen: 'DatasetCompare',
    route: '/datasets/DS-0311/compare',
    state: rec('DS-0311'),
  },
  // `RecordDetail` renders the notebook surface (`/records/CB-0012` redirects
  // into it), inspector included. Deliberate divergence recorded 2026-10-16:
  // the inspector's list rows are compact and borderless (JH-1 row chrome),
  // which the design's own referenced-record rows (`table.ref` in
  // `Notebook.dc.html`) and `.row-l` hairline also are. The comparison sits at
  // cause 3 already; the `Notebook-light/dark` rows that would compare these
  // lists are pending. See
  // `docs/knowledge/design/row-chrome-migration.md` §Design-set impact before
  // re-measuring or re-rendering this row.
  { screen: 'RecordDetail', route: '/records/CB-0012', state: rec('CB-0012') },
  {
    screen: 'RecordInstrument',
    route: '/instruments/INS-0007',
    state: rec('INS-0007'),
  },
  { screen: 'PipelineRuns', route: '/pipelines/PL-0003/runs' },
  { screen: 'PipelineRun', route: '/pipelines/PL-0003/runs/latest' },
  { screen: 'PipelineRunFailed', route: '/pipelines/PL-0014/runs/latest' },
  { screen: 'SettingsGeneral', route: '/settings' },
  { screen: 'SettingsMembers', route: '/settings/members' },
  { screen: 'SettingsAccess', route: '/settings/access' },
  {
    screen: 'SettingsIntegrations',
    route: '/settings/integrations',
  },
  {
    screen: 'IntegrationDeliveries',
    route: '/settings/integrations/document-management',
  },
])

/**
 * Screens that cannot be compared yet, with the reason. Grouped by the work
 * that unblocks them; every screen not in `DESIGN_STATES` must appear here.
 */
export const DESIGN_PENDING: ReadonlyArray<{
  reason: string
  screens: readonly string[]
}> = [
  {
    reason:
      'Needs a driven UI state (empty / error / loading / offline / conflict / dialog) the app has no hook for yet; the state driver refuses these rather than comparing the wrong page.',
    screens: [
      'AnalysisEmpty',
      'DatasetsError',
      'DialogsCreate',
      'DialogsRecord',
      'ExperimentsLoading',
      'FolderMove',
      'ImportFailed',
      'InboxEmpty',
      'NbConflict',
      'NbEditing',
      'NbLoading',
      'NbNew',
      'NbOffline',
      'NbSigned',
      'NbViewer',
      'PromoteRejected',
      'ProjectsEmpty',
      'ProjectsError',
      'ProjectsNoResults',
      'SampleExpired',
      'SampleHistory',
      'SampleMeasurements',
      'SampleQuarantine',
      'SamplesEmpty',
      'ScheduleEmpty',
      'SearchEmpty',
      'SheetEmpty',
      'SheetPromote',
      'SnapshotRemoved',
      'TokenExpired',
      'EvidenceCompare',
    ],
  },
  {
    reason:
      'Needs design-seed data the seed does not create yet (list rows, models, templates, protocol training, audit entries, scheduler, connector deliveries, analyses).',
    screens: [
      'Analysis',
      'AuditLog',
      'HomeBench',
      'HomeTriage',
      'ImportMap',
      'ImportUpload',
      'IntegrationConnect',
      'ModelFields',
      'ModelRecords',
      'ModelVersions',
      'NewExperiment',
      'Notebook',
      'Panels',
      'PipelineEditor',
      'PipelineRunWaiting',
      'PipelineTriggers',
      'PipelinesList',
      'ProjectFolders',
      'ProtocolDetail',
      'ProtocolsList',
      'RecordNew',
      'RecordPhone',
      'ReviewApproved',
      'ReviewReturned',
      'SchemaEditor',
      'SchemaPending',
      'SchemasList',
      'SearchPalette',
      'SearchResults',
      'SettingsApi',
      'SettingsInstruments',
      'SettingsNotifications',
      'SettingsProfile',
      'States',
      'TemplateEditor',
      'TemplateUpdate',
      'TemplatesList',
      'TokenCreate',
    ],
  },
  {
    reason:
      'Responsive variant of a mapped route at a laptop/tablet/phone frame; needs a size-scoped comparison before it can be mapped.',
    screens: [
      'EvidencePhone',
      'NotebookLaptop',
      'NotebookTablet',
      'PhoneHome',
      'PhoneInbox',
      'PhoneReading',
      'PhoneSample',
      'PhoneScan',
      'PhoneWithdraw',
      'SheetTablet',
      'SnapshotsLaptop',
    ],
  },
  {
    reason:
      'Global chrome / keyboard-surface screen with no equivalent app route yet (focus order, shortcuts overlay, component states board).',
    screens: ['FocusOrder'],
  },
]

/**
 * Seeded design users (DSYS-05.1). Kept here as plain IDs so the parity suite
 * does not import the seed module (which opens a database connection).
 */
export const DESIGN_USER_IDS: Record<string, string> = {
  gareth: '00000000-0000-4000-8000-000000000310',
  priya: '00000000-0000-4000-8000-000000000311',
  mei: '00000000-0000-4000-8000-000000000312',
  tom: '00000000-0000-4000-8000-000000000313',
  sam: '00000000-0000-4000-8000-000000000314',
  anna: '00000000-0000-4000-8000-000000000315',
  clientAna: '00000000-0000-4000-8000-000000000316',
  clientBen: '00000000-0000-4000-8000-000000000317',
  firstRunEditor: 'design-scenario-first-run-editor',
}
