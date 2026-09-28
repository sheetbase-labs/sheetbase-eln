# LAB — Samples, Materials, Instruments and Protocols

**Status (2026-09-27):** Proposed; not assigned. LAB-05 follows [DEC-10](DEC.md); LAB-04 follows [DEC-07](DEC.md).

## Programme goal

Model the physical lab faithfully: how much of a sample is left and why, what
may be used, which lots are in date, which instruments are fit to use, and
which protocol version people are trained on.

## Baseline at `main` `9538f36`

- Samples are records with `sample_events` (`create`, `receive`, `consume`,
  `transfer`, `edit`, `archive`, `restore`), lineage (`/lineage`,
  `record_links`), quarantine status and a storage hierarchy (sites to
  positions) with movements.
- Reagents with expiry (`reagent-data.ts`, `/reagents`).
- `instruments` with type, model, serial, vendor and connection status;
  instrument runs, raw files and QC checks (`/instrument-monitor`).
- Protocols are records of kind `protocol_template` with a materials block
  contract (ADR-0027); `/templates?protocol=`.
- No hold-time limit, release checks, reservations, label printing, barcode
  scanning, calibration, user qualification, protocol training or periodic
  review.

## LAB-01 — Withdrawals and reservations

**Status:** proposed.

### Design

Withdraw dialog in `canvas/DialogsRecord.dc.html`, `canvas/SampleUsage.dc.html`,
`canvas/SampleDetail.dc.html`, `canvas/PhoneWithdraw.dc.html`.

### Scope

Withdraw volume with purpose (experiment), unit, optional new container and
label; over-withdrawal refused with the available amount; reservations for
planned experiments; used / reserved / free bar; usage table; derived-sample
creation from a withdrawal. Build on the `consume` event rather than a second
ledger.

### Start here

`api.sample_events` (`operation` create/receive/consume/transfer/edit/archive/restore,
`quantity_delta`, `quantity_before`, `quantity_after`, `quantity_unit`),
sample RPCs in `drizzle/0041_reg_002_sample_events.sql` (consume, receive,
transfer, edit), pipeline action wrappers in `src/lib/pipelines/actions.ts`,
`src/lib/samples.tsx`, `src/components/samples/sample-inspector.tsx`,
`tests/db/samples.test.ts`.

### Steps (PRs)

1. `withdraw_sample` RPC on top of `consume`: purpose record, optional new
   derived sample (container + label), refusal when the result would go below
   zero or into reserved volume; audited with purpose. DB tests.
2. Reservations: `api.sample_reservations` (sample, experiment, quantity,
   planned) with RPCs; free = current − reserved; shown on the sample.
3. Withdraw dialog (`DialogsRecord`), Usage tab (`SampleUsage`) with the
   used/reserved/free bar.

### Check it

DB tests for over-withdrawal and reservation; parity for `SampleUsage` and the
withdraw dialog.

### Exit

Remaining volume is always computed from events (tested); a withdrawal that
would go below zero or into reserved volume without permission is refused on
the server.

## LAB-02 — Hold time, quarantine and release

**Status:** proposed.

### Design

`canvas/SampleQuarantine.dc.html`, `canvas/SampleExpired.dc.html`,
`canvas/SampleConsumed.dc.html`, `canvas/SampleDetail.dc.html`.

### Scope

Hold limit per sample (condition and duration from harvest); "hold time
exceeded" state with allowed uses; release checks derived from measurements
(LAB-03) with release by an authorised person; record disposal; consumed
state kept for lineage and audit.

### Start here

Sample status and quarantine in `src/lib/samples.tsx` and the registry
(`src/components/registry/`), `edit_sample` RPC, measurements from datasets
(LAB-03), scheduled jobs pattern (`src/lib/pipeline-scheduler.server.ts`).

### Steps (PRs)

1. Hold limit fields (condition, duration from harvest) on samples; a
   scheduled job moving samples to `hold_exceeded` as System with an audit
   event; allowed-use list (experiments that may still withdraw).
2. Release checks: rule set per sample type (from the model, MDL-02) evaluated
   against measurements; `release_sample` RPC requiring the capability and
   passing checks; quarantine with reason; disposal record.
3. Banners and pages (`SampleQuarantine`, `SampleExpired`, `SampleConsumed`).

### Check it

DB tests: withdrawal refused when on hold or quarantined unless allowed;
release refused when checks fail; parity for the three boards.

### Exit

A sample past its hold limit or in quarantine cannot be withdrawn for an
experiment that is not explicitly allowed (server-enforced); the state change
is automatic and audited as System.

## LAB-03 — Sample record pages

**Status:** proposed. **DEC-03:** absorbs the `/lineage` provenance explorer into the Lineage tab and evidence pages; the standalone route retires.

### Design

`canvas/SamplesList.dc.html`, `SamplesEmpty`, `SampleDetail`, `SampleLineage`,
`SampleUsage`, `SampleMeasurements`, `SampleHistory`.

### Scope

`/samples/$sampleId` with tabs Details, Lineage (tree with relation and the
experiment that made each derivation, "where this lot went"), Usage,
Measurements (aggregated from dataset rows and QC results with source; values
cannot be typed here), History; label card and hold-time meter in the
inspector. Samples list with status tabs and inspector.

### Start here

`src/routes/samples.tsx` (880, registry with `?selected=`),
`src/routes/lineage.tsx` (1,236), `src/lib/lineage-data.ts`,
`src/components/knowledge/record-lineage-section.tsx`,
`src/components/samples/sample-inspector.tsx`.

### Steps (PRs)

1. `/samples` list per `SamplesList` (status tabs, inspector) and
   `/samples/$sampleId` layout with tabs; redirect `?selected=`.
2. Details and Lineage tabs (tree from `lineage-data.ts` with relation and
   producing experiment; "where this lot went").
3. Measurements tab: read model joining dataset rows linked to the sample and
   integration results (QC LIMS); read-only with source links.
4. History tab from sample events; label card and hold-time meter.

### Check it

Parity for `SampleDetail`, `SampleLineage`, `SampleMeasurements`,
`SampleHistory`, `SamplesList`, `SamplesEmpty`.

### Exit

The measurement tab shows only values from datasets or integrations with a
link to their row; the seeded SMP-2231 matches the design.

## LAB-04 — Materials and lots

**Status:** proposed; [DEC-07](DEC.md) accepted 2026-09-27 ([ADR-0051](../../decisions/0051-workspace-defined-record-models.md)): materials are built-in, not workspace-defined. **DEC-03:** absorbs `/storage` locations; the standalone route retires.

### Design

`canvas/MaterialsList.dc.html`; material rows in `canvas/Notebook.dc.html`.

### Scope

Material lots with supplier, catalogue number, lot, stock, location, received,
released by, certificate (file), expiry; receive lot; register replacement lot;
quarantine; list tabs (in stock, expiring in 30 days, quarantine, expired);
experiments cannot reference an expired lot; expiring lots raise work items.

### Start here

`src/routes/reagents.tsx` (1,117), `src/lib/reagent-data.ts` (supplier,
catalog no, lot, expiry, quantity, unit, storage; thresholds),
`src/components/reagents/`, `tests/db/reagents.test.ts`.

### Steps (PRs)

1. Per DEC-07, either rename reagents to materials (kind, routes, copy) or
   create a Material lot model; migrate existing reagent rows.
2. Receive lot, register replacement lot, quarantine, CoA file link, released
   by; RPC refusing references to expired or quarantined lots from
   experiments (materials block, sheet record links).
3. `/materials` per `MaterialsList`; expiry work items (WORK-01).

### Check it

DB test for the expired-lot refusal; parity for `MaterialsList`.

### Exit

`/materials` replaces `/reagents`; referencing an expired or quarantined lot is
refused on the server; expiry reminders appear in WORK-01.

## LAB-05 — Labels and scanning

**Status:** proposed; [DEC-10](DEC.md) accepted 2026-09-27: the lab has no specific printers, so printing is browser print (no print gateway) and the 2D code payload is `https://<host>/r/<identifier>`. The UI port added `/scan`, resolving canonical identifiers (records and instruments) with a typed fallback and camera BarcodeDetector; label templates, printing, the `/r/<identifier>` resolver and aliases remain.

### Design

`canvas/PhoneScan.dc.html`, `PhoneSample`, `RecordPhone`; print actions on
sample pages; label card on `canvas/SampleDetail.dc.html`.

### Scope

Label templates (ID, name, condition, use-by, 2D code encoding the stable ID
URL); print to a named printer with a toast; scan with the device camera
(BarcodeDetector with a fallback), type an ID when scanning fails; last scan;
scans resolve any record kind by ID.

### Start here

Nothing exists. Storage positions (`src/lib/storage.ts`,
`src/components/storage/`) hold location data for labels.

### Steps (PRs)

1. Label template model and renderer (ID, name, condition, use-by, QR code of
   `https://<host>/r/<identifier>`), preview in the sample inspector.
2. Browser print (no print gateway; the lab has no specific printers), with the
   label template rendered as a print document; print event recorded on the
   sample; toast per design.
3. `/r/<identifier>` resolver route to the right record page.
4. Camera scanning component (`BarcodeDetector` where available, a
   WASM decoder fallback) with typed-ID fallback; used by MOB-02.

### Check it

Unit tests for label payload and resolver; browser test scanning a rendered
QR image; print event in history.

### Exit

A printed label scanned on a phone opens the right record; printing is
recorded in the sample's History.

## LAB-06 — Instruments: identity, calibration and qualification

**Status:** proposed. **DEC-03:** absorbs `/instrument-monitor`; the standalone route retires. The UI port added the `/instruments` list and `/instruments/$instrumentId` detail over the existing `api.instruments` / `api.instrument_runs` tables, and retired `/instrument-monitor`; calibration, qualification, used-by and the run telemetry surface remain.

### Design

`canvas/RecordInstrument.dc.html`, `canvas/SettingsInstruments.dc.html`,
book-instrument dialog in `canvas/DialogsRecord.dc.html`.

### Scope

Instruments as first-class records with a stable ID (INS-), rename and move
history, "also known as" and signed-text display rules (signed records keep
the name used when signed, with the current name beside it); calibration last,
due and certificate; qualified-for flag; user qualification per instrument
with expiry; used-by list.

### Start here

`api.instruments` (name, type, model, serial, vendor, connection status),
`src/lib/instrument-monitor.ts`, `src/routes/instrument-monitor.tsx`,
calendar resources in `src/lib/calendar.ts` (instruments are bookable
resources), `tests/db/instrument-monitor.test.ts`, `tests/db/calendar.test.ts`.

### Steps (PRs)

1. Instrument records with stable `INS-nnnn` identifiers; name/location
   history; "also known as".
2. Calibration (last, due, certificate file) and `qualified_for`; user
   qualification table (user, instrument, valid until) with RPCs.
3. Booking RPC checks qualification and calibration (WORK-04).
4. Signed text display rule: evidence renders the name captured at signing
   plus the current name (REV-04 uses it).
5. Instrument page `RecordInstrument`.

### Check it

DB tests for booking refusal and rename safety; parity for `RecordInstrument`.

### Exit

Renaming an instrument breaks no link and leaves signed text unchanged
(tested); booking checks in WORK-04 read calibration and qualification.

## LAB-07 — Controlled protocols

**Status:** proposed; controlled-document rules may interact with GXP-01.

### Design

`canvas/ProtocolsList.dc.html`, `canvas/ProtocolDetail.dc.html`,
`canvas/NewExperiment.dc.html`, method block in `canvas/NbNew.dc.html`.

### Scope

- Protocol versions with status (draft, in QA review, effective, superseded,
  retired), effective date, approval chain (author, technical review, QA),
  change summary from the previous version.
- Sections: purpose, parameters with units and tolerances, procedure,
  acceptance criteria; linked template (SHEET-04).
- Read-and-acknowledge training per version with reminders; people who have
  not acknowledged cannot start an experiment from it.
- Periodic review due date with confirm-as-current or start a new version.
- Experiments keep the version they started on; editing linked protocol text
  inside a notebook records a deviation.
- Used-by list per version.

### Start here

Protocols are records of kind `protocol_template`; `api.pin_protocol_reference`,
`src/lib/protocol-materials.ts`, protocol blocks
(`src/components/notebook/protocol-material-blocks.test.tsx`),
`src/routes/templates.tsx` (`?protocol=`), `tests/db/protocol-material-blocks.test.ts`,
ADR-0027.

### Steps (PRs)

1. Protocol versions with status (draft, in review, effective, superseded,
   retired), effective date, change summary; approval via MDL-03's
   `approval_requests` (author, technical review, QA).
2. Structured sections (purpose, parameters with unit/tolerance, procedure
   steps, acceptance criteria) as protocol blocks; step IDs used by EXP-02.
3. Training: `api.protocol_acknowledgements` (user, version, acknowledged at),
   reminders; `start_experiment` refuses when not acknowledged.
4. Periodic review date and confirm-as-current / start new version.
5. Deviation recording when linked protocol text is edited in a notebook.
6. `/protocols` and `/protocols/$protocolId` per design.

### Check it

DB tests for effective-only start, training enforcement and deviation
recording; parity for `ProtocolsList`, `ProtocolDetail`.

### Exit

Only effective versions can start experiments where the project requires it;
training is enforced at start; deviations appear in the experiment's History
and review.
