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

### Exit

A sample past its hold limit or in quarantine cannot be withdrawn for an
experiment that is not explicitly allowed (server-enforced); the state change
is automatic and audited as System.

## LAB-03 — Sample record pages

**Status:** proposed.

### Design

`canvas/SamplesList.dc.html`, `SamplesEmpty`, `SampleDetail`, `SampleLineage`,
`SampleUsage`, `SampleMeasurements`, `SampleHistory`.

### Scope

`/samples/$sampleId` with tabs Details, Lineage (tree with relation and the
experiment that made each derivation, "where this lot went"), Usage,
Measurements (aggregated from dataset rows and QC results with source; values
cannot be typed here), History; label card and hold-time meter in the
inspector. Samples list with status tabs and inspector.

### Exit

The measurement tab shows only values from datasets or integrations with a
link to their row; the seeded SMP-2231 matches the design.

## LAB-04 — Materials and lots

**Status:** proposed; after [DEC-07](DEC.md), which decides whether materials are built-in or a workspace-defined model.

### Design

`canvas/MaterialsList.dc.html`; material rows in `canvas/Notebook.dc.html`.

### Scope

Material lots with supplier, catalogue number, lot, stock, location, received,
released by, certificate (file), expiry; receive lot; register replacement lot;
quarantine; list tabs (in stock, expiring in 30 days, quarantine, expired);
experiments cannot reference an expired lot; expiring lots raise work items.

### Exit

`/materials` replaces `/reagents`; referencing an expired or quarantined lot is
refused on the server; expiry reminders appear in WORK-01.

## LAB-05 — Labels and scanning

**Status:** proposed; after [DEC-10](DEC.md).

### Design

`canvas/PhoneScan.dc.html`, `PhoneSample`, `RecordPhone`; print actions on
sample pages; label card on `canvas/SampleDetail.dc.html`.

### Scope

Label templates (ID, name, condition, use-by, 2D code encoding the stable ID
URL); print to a named printer with a toast; scan with the device camera
(BarcodeDetector with a fallback), type an ID when scanning fails; last scan;
scans resolve any record kind by ID.

### Exit

A printed label scanned on a phone opens the right record; printing is
recorded in the sample's History.

## LAB-06 — Instruments: identity, calibration and qualification

**Status:** proposed.

### Design

`canvas/RecordInstrument.dc.html`, `canvas/SettingsInstruments.dc.html`,
book-instrument dialog in `canvas/DialogsRecord.dc.html`.

### Scope

Instruments as first-class records with a stable ID (INS-), rename and move
history, "also known as" and signed-text display rules (signed records keep
the name used when signed, with the current name beside it); calibration last,
due and certificate; qualified-for flag; user qualification per instrument
with expiry; used-by list.

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

### Exit

Only effective versions can start experiments where the project requires it;
training is enforced at start; deviations appear in the experiment's History
and review.
