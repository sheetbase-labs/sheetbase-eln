# 0021. HyperFormula trust and persistence model

- Status: Accepted
- Date: 2026-07-19
- Ticket: CALC-001
- Builds on: 0016, 0019, 0020

## Context

Sheetbase needs familiar formulas without making a browser workbook, a grid
coordinate or a cached result authoritative scientific data. HyperFormula uses
runtime numeric sheet IDs and positional A1 references, while Sheetbase tables,
rows and columns have durable UUIDs and editable display labels. The same
definition must also survive reloads, schema changes, REST-originated edits and
engine upgrades.

## Decision

### Workbook and identity boundary

There is one HyperFormula instance per active notebook record and one engine
sheet per active sheet block. A workbook never crosses a notebook boundary.
PostgreSQL UUIDs remain authoritative; HyperFormula sheet IDs and A1
coordinates are disposable runtime projections.

Each engine sheet uses a deterministic, non-user-controlled name derived from
the scientific table UUID. The workbook adapter maintains
`table UUID <-> engine sheet name <-> runtime sheet ID` and current ordered
`row UUID <-> row index` and `column UUID <-> column index` maps. Friendly
sheet and column labels are accepted and rendered at the UI boundary only.
Renaming or reordering display metadata does not rewrite a durable dependency.

A formula version stores:

- its target `(table_id, row_id, column_id)` and optimistic version;
- the submitted source expression for provenance;
- a versioned Sheetbase template IR containing normalized operators, functions
  and literals plus numbered reference slots;
- one binding per slot: a cell UUID tuple or the ordered rectangular matrix of
  cell UUID tuples captured for a finite range, including copy/fill anchor
  flags;
- a derived normalized HyperFormula expression for the layout against which it
  was validated;
- dependency edges expanded to stable source identities;
- syntax-profile, function-profile and exact engine versions.

The Sheetbase restricted parser creates the template and bindings; HyperFormula
internals are not used as a parser API. Reference bindings, not source-text
spans, A1 coordinates, display names or HyperFormula AST objects, are the
durable meaning. `getCellFormula()` is used for compatibility checking only
after installing a derived formula at its real target in a fully built
workbook. On reconstruction the adapter resolves bindings and emits fresh
engine text. Missing or retired identities produce a structured `REF` state;
they are never silently rebound to the cell now occupying an old coordinate.

Rows use immutable calculation order `(created_at, id)` and columns use
immutable calculation order `(created_at, id)`, including retained retired
sources; viewport sorting/filtering and `display_order` never affect formulas.
A finite range's captured member matrix never gains or loses members after
insert, reorder or rename. Absolute/relative flags affect only creation of a
new formula by copy/fill; each saved formula has fixed bindings. A displayed
range that is not rectangular and contiguous in calculation order is rejected
with an explanation rather than rebound. Dependency edges are a rebuildable
projection of the bound members.

Friendly labels resolve case-insensitively only when unique in scope. The
formula editor's autocomplete emits a visible disambiguated token carrying the
stable table/column UUID when labels collide; ambiguous unqualified text is
rejected. Cross-sheet bindings are accepted only when both tables belong to the
same notebook and workspace, enforced in PostgreSQL.

### Syntax, locale and compatibility

The first syntax profile is `sheetbase-hf-en-us-v1`: formulas begin with `=`,
use English canonical function identifiers, `.` decimal separators, `,`
arguments, ISO `YYYY-MM-DD` dates and an `en-US` comparison locale. It accepts
parentheses; scalar string, Boolean and finite numeric literals; unary `+`, `-`
and `%`; binary `+`, `-`, `*`, `/`, `^`, `&`, `=`, `<>`, `<`, `<=`, `>` and
`>=`; approved function calls; individual references; and finite rectangular
ranges. It rejects named expressions, aliases not explicitly listed, arrays and
spill formulas, whole-row/whole-column ranges, 3D/external references and any
non-scalar output. Formula text is limited to 8,192 characters, 10,000 reference
slots and 100,000 captured range cells.

The exact calculation profile explicitly sets `language: 'enUS'`,
`localeLang: 'en-US'`, `decimalSeparator: '.'`, `thousandSeparator: ''`,
`functionArgSeparator: ','`, `arrayColumnSeparator: ','`,
`arrayRowSeparator: ';'`, `currencySymbol: []`,
`ignoreWhiteSpace: 'standard'`,
`dateFormats: ['YYYY-MM-DD']`, `timeFormats: ['hh:mm', 'hh:mm:ss.sss']`,
`nullDate: {year: 1899, month: 12, day: 30}`, `nullYear: 30`,
`leapYear1900: false`, `evaluateNullToZero: false`, `useArrayArithmetic: false`,
`precisionEpsilon: 1e-13`, `precisionRounding: 10`, `smartRounding: true`,
`caseSensitive: false`, `accentSensitive: false`, `caseFirst: 'lower'`,
`ignorePunctuation: false`, `matchWholeCell: true`,
`useRegularExpressions: false`, `useWildcards: false`, `maxRows: 10_000`,
`maxColumns: 256`, `functionPlugins: []`, `undoLimit: 0`,
`useColumnIndex: false`, `useStats: false` and
`maxPendingLazyTransformations: 50`. Address-mapping strategy is the package's
`AlwaysSparse` implementation and `context` is absent. CALC-002 enforces the
same 10,000-row and 256-column limits at formula-write/schema-write boundaries;
an over-limit table remains editable as literals but its calculation status is
`unavailable`, never partially loaded.

Startup imports the exact `enUS` translation from HyperFormula 3.3.0 and calls
`HyperFormula.registerLanguage('enUS', enUS)` before the first instance. No
custom plugin is registered: the exact package's built-in registry remains
available, while the Sheetbase parser enforces `scientific-core-v2`. Startup
asserts every allowed function ID and records the sorted
`function ID -> built-in plugin constructor name` map in the profile
fingerprint.

Date parsing and rendering use named shared functions
`sheetbaseParseDateTimeV1`, `sheetbaseStringifyDateTimeV1` and
`sheetbaseStringifyDurationV1`; they accept only the profile's ISO/24-hour
formats and operate on numeric UTC components without ambient locale/timezone.
Their source version, all resolved options above, exact package version,
language checksum, function map and Node/V8/ICU/TZ identifiers are hashed into
the browser/server fingerprint. Address-map storage choice and diagnostic
statistics are non-semantic, but remain explicit to prevent configuration
drift. User-localized text is translated before validation. HyperFormula's
normalized formula APIs check derived engine text; internal parser ASTs are
never persisted.

CALC-002 pins HyperFormula `3.3.0` exactly in browser and Node execution.
Handsontable 18 supports HyperFormula `^3.0.0`, but a package, syntax profile or
function profile change is a controlled compatibility migration: rebuild every
fixture workbook, compare definitions, dependencies, typed values and errors,
then explicitly advance the stored profile. A formula from an unknown/newer
profile remains durable but is `unavailable`, never guessed.

This non-commercial demo uses HyperFormula's documented GPLv3 mode
(`licenseKey: 'gpl-v3'`) for both detached browser workbooks and server
calculation. Handsontable continues to use
`non-commercial-and-evaluation`. These public mode strings are configuration,
not secrets. Commercial distribution requires a licensing decision before
release; `internal-use-in-handsontable` is not valid for detached server use.

### Function profile

Profiles `scientific-core-v1` (superseded) and `scientific-core-v2` (current)
are accepted. v2 is a strict superset of v1: it adds 112 built-in HyperFormula
3.3.0 functions while keeping the v1 allow-list intact. Existing v1
definitions are migrated to v2 by the `0055_calc_005_function_profile_v2`
migration; v1 definitions remain valid because every v1 function is also in v2.

v2 allows operators, cell/range references and these function IDs:

- v1 aggregation/statistics: `SUM`, `PRODUCT`, `SUMSQ`, `AVERAGE`, `MEDIAN`,
  `MIN`, `MAX`, `COUNT`, `COUNTA`, `STDEV.S`, `STDEV.P`, `VAR.S`, `VAR.P`;
- v1 numeric/scientific: `ABS`, `SIGN`, `MOD`, `POWER`, `SQRT`, `EXP`, `LN`,
  `LOG`, `LOG10`, `ROUND`, `ROUNDDOWN`, `ROUNDUP`, `INT`, `PI`, `SIN`, `COS`,
  `TAN`, `ASIN`, `ACOS`, `ATAN`, `ATAN2`, `DEGREES`, `RADIANS`;
- v1 logical/error: `IF`, `IFS`, `AND`, `OR`, `NOT`, `IFERROR`, `IFNA`, `NA`;
- v1 inspection/lookup: `ISBLANK`, `ISERROR`, `ISNA`, `ISNUMBER`, `ISTEXT`,
  `INDEX`, `MATCH`, `XLOOKUP`;
- v1 deterministic date parts: `DATE`, `TIME`, `YEAR`, `MONTH`, `DAY`, `HOUR`,
  `MINUTE`, `SECOND`;
- v2 statistics: `STDEV`, `STDEVA`, `STDEVP`, `STDEVPA`, `VAR`, `VARA`,
  `VARP`, `VARPA`, `COVARIANCE.P`, `COVARIANCE.S`, `CORREL`, `PEARSON`,
  `NORM.DIST`, `NORM.INV`, `NORM.S.DIST`, `NORM.S.INV`, `T.DIST`, `T.DIST.2T`,
  `T.INV`, `T.INV.2T`, `T.TEST`, `CHISQ.DIST`, `CHISQ.INV`, `CHISQ.TEST`,
  `F.DIST`, `F.INV`, `F.TEST`, `PERCENTILE`, `PERCENTILE.INC`,
  `PERCENTILE.EXC`, `QUARTILE`, `QUARTILE.INC`, `QUARTILE.EXC`, `LARGE`,
  `SMALL`, `SKEW`, `SKEW.P`, `CONFIDENCE`, `CONFIDENCE.NORM`,
  `CONFIDENCE.T`, `AVERAGEIF`, `SUMIF`, `SUMIFS`, `COUNTIF`, `COUNTIFS`,
  `GEOMEAN`, `HARMEAN`, `RSQ`;
- v2 math: `MROUND`, `CEILING`, `CEILING.MATH`, `FLOOR`, `FLOOR.MATH`,
  `FACT`, `FACTDOUBLE`, `COMBIN`, `GCD`, `LCM`, `SERIESSUM`, `SUMPRODUCT`,
  `SUBTOTAL`, `BASE`, `DECIMAL`, `ROMAN`, `ARABIC`;
- v2 lookup/reference: `VLOOKUP`, `HLOOKUP`, `CHOOSE`, `COLUMNS`, `ROWS`,
  `ADDRESS`, `TRANSPOSE`, `FILTER`, `SEQUENCE`;
- v2 text: `LEFT`, `RIGHT`, `MID`, `LEN`, `FIND`, `SEARCH`, `REPLACE`,
  `SUBSTITUTE`, `UPPER`, `LOWER`, `PROPER`, `TRIM`, `CLEAN`, `CONCATENATE`,
  `TEXTJOIN`, `TEXT`, `VALUE`, `REPT`;
- v2 date/time: `DATEDIF`, `DATEVALUE`, `TIMEVALUE`, `NETWORKDAYS`, `WORKDAY`,
  `EOMONTH`, `EDATE`, `WEEKDAY`, `WEEKNUM`, `ISOWEEKNUM`;
- v2 logical: `TRUE`, `FALSE`, `XOR`, `SWITCH`;
- v2 information: `ISLOGICAL`, `ISNONTEXT`, `ISODD`, `ISEVEN`, `ISREF`, `N`.

The Sheetbase parser/template validator is the authoritative allow-list. A
controlled per-instance plugin set and startup assertions against HyperFormula's
static registry are defense in depth, and registry mutation is forbidden after
startup. Protected/special `OFFSET` and `VERSION` tokens are rejected lexically.
A syntactically valid definition containing any other function may be retained
for provenance with status `unsupported`, but cannot produce a current trusted
result. No named expressions, asynchronous functions or custom functions are
allowed.

The persisted-formula validator is intentionally lenient about the
`unsupported` → `supported` direction: a formula persisted as `unsupported`
under v1 may become calculable after the allow-list expands to v2, so
`unsupported` status with no unsupported functions is a benign transitional
state. The reverse (`supported` with unsupported functions) remains an
integrity violation. The `0055` migration reclassifies previously-unsupported
definitions whose functions are all admitted by v2.

`RAND`, `RANDBETWEEN`, `NOW` and `TODAY` remain explicitly unsupported because
rebuilds and browser/server clocks cannot reproduce them. Coordinate-
introspective functions `ROW`, `COLUMN`, `OFFSET` and `INDIRECT` remain
excluded because they would make disposable coordinates part of scientific
meaning. `ROWS` and `COLUMNS` are admitted in v2 because they return
deterministic range dimensions derived from UUID-bound captured members, not
disposable absolute coordinates. `FORMULATEXT` remains excluded.

### Literals, definitions and result caches

A target cell contains either a typed PostgreSQL literal or one durable formula
definition, never both, as established by ADR 0019. Creating/updating a formula
locks the generated row, validates its stable target and dependencies, clears
the literal, updates `formula_column_ids` and writes the definition in one RPC.
Removing one atomically clears the marker and writes either SQL `NULL` or an
explicit replacement literal.

Profile `sheetbase-literal-v1` performs all PostgreSQL/engine conversion. Text
and category UUIDs are installed as forced literal strings, never reparsed as
formula, Boolean, percentage or date input. Integers outside JavaScript's safe
integer range and numeric values with more than 15 significant digits, binary64
overflow or non-finite values are unsupported rather than rounded silently.
Dates are converted from validated ISO components to the pinned null-date serial;
timestamps are normalized to UTC components first; ambient `Date`, timezone and
browser parsing are forbidden. Null stays an empty engine cell. Results retain
both engine scalar type and target PostgreSQL logical type and must pass the
target codec; mismatch or precision loss is a structured `VALUE` error, not an
implicit database cast.

HyperFormula values and errors are derived. Optional result caches are separate
records containing typed value or structured error, formula version, notebook
input revision, relevant schema revisions, engine/profile versions,
calculation status and `calculated_at`. A cache is `current` only when every
revision matches a completed server calculation; otherwise it is `stale`,
`pending`, `failed` or `unavailable`. Raw generated-row REST resources continue
to expose authoritative literals and never substitute cached results.

### Recalculation and trust

Every relevant committed mutation atomically increments one monotonic
`calculation_input_revision` on the notebook in PostgreSQL before emitting its
durable event:

- UI or REST literal insert/update/delete;
- formula create/update/remove;
- table or column add, reorder, conversion or retirement;
- dependency-affecting named metadata changes.

The live client patches/rebuilds its notebook workbook and recalculates after
those events. Notebook load always reconstructs from all current metadata,
literals and formula definitions; it never restores an opaque serialized
engine. UI edits can calculate an immediate preview, batched with HyperFormula's
`batch()` where appropriate, but browser output is not trusted outside that
session.

Direct generated-row triggers perform this increment in the same transaction,
so correctness does not depend on event delivery or complete dependency edges.
Cache `stale` state is derived from revision inequality; eagerly updating cache
rows is optional.

API-visible `current` results require controlled Node/server recalculation with
the exact package, profiles, locale/ICU environment and input revision. A
trusted application-server formula-write path accepts target, source and
expected versions, runs the Sheetbase parser itself, and passes its derived
artifact to an internal database transaction. Browser and API-client roles
cannot write arbitrary bindings or edges; unvalidated submissions never affect
trusted results or dependency preflight.

The CALC-004 worker claims one notebook revision, reconstructs and calculates
the entire workbook, then atomically writes all result caches only under a
compare-and-swap/lock proving the notebook revision still equals the claim. A
mismatch or worker failure writes no partial result set. The server runtime pins
Node, V8, ICU data and `TZ=UTC`; their fingerprint and calculation-profile
version accompany caches. Browser parity is fixture-tested but does not make
browser results trusted. Calculation completion/failure emits lightweight
events without formula text or row values.

### Errors and dependency states

Formula definitions survive calculation failure. HyperFormula errors are
persisted structurally as `DIV_BY_ZERO`, `NAME`, `VALUE`, `NUM`, `NA`, `CYCLE`,
`REF`, `SPILL`, `LIC` or `ERROR`, plus engine/profile version and safe
diagnostics; localized strings are presentation only. Sheetbase adds
`unsupported`, `stale`, `pending` and `unavailable` states.

Cycles, including cross-sheet cycles, are valid durable definitions with a
current structured `CYCLE` result, not crashes or implicit zeroes. Likewise a
completed `DIV_BY_ZERO` or `REF` evaluation is a current structured result;
`failed` means the server job itself did not complete. Unsupported functions
show `unsupported`; missing/retired dependencies show `REF`; licence or engine
profile mismatch shows `unavailable`. Formula text and a stable-identity
dependency inspection view remain available in all states. Schema retirement,
conversion and source deletion must preflight dependants and require explicit
confirmation or reject the operation before definitions become unreachable.

## Consequences

- Friendly formulas remain approachable while UUID bindings preserve meaning
  through display-name and coordinate changes.
- Browser calculation stays responsive, but only revision-matched server output
  is trustworthy to API consumers and later review workflows.
- Full-notebook reconstruction costs more than restoring engine internals, but
  is deterministic, auditable and upgradeable.
- The v1 allow-list is intentionally smaller than HyperFormula's built-ins.
  Expanding it requires a versioned profile and browser/server parity tests.
- Volatile and coordinate-introspective formulas are unavailable in v1 rather
  than producing irreproducible scientific results.
