# MOB — Phone at the Bench

**Status (2026-09-27):** Proposed; not assigned. Depends on WORK-01, LAB-01 and LAB-05.

## Programme goal

A scientist with gloves on and a phone in hand can see today's work, scan a
label, withdraw volume and record a reading, and nothing else gets in the way.

## Baseline at `main` `9538f36`

The app is responsive to tablet width through the NAV-01 drawer; there is no
phone layout, no camera scanning and no bench-specific flow.

## MOB-01 — Phone shell

**Status:** proposed.

### Design

`canvas/PhoneHome.dc.html`, `canvas/PhoneInbox.dc.html`,
`design-system/components/Navigation/README.md` (phone tabs).

### Scope

Below 600px the shell becomes a phone bar and a three-item bottom bar (Today,
Scan, Inbox); 44px minimum targets; Today shows your bookings and items that
need you; Inbox lists WORK-01 items, with review and signing sending you to
the full record on a larger screen. Same routes and data as desktop.

### Exit

Today and Inbox match the design at 390×844 on seeded data and pass touch
target and contrast checks.

## MOB-02 — Bench flows

**Status:** proposed.

### Design

`canvas/PhoneScan.dc.html`, `PhoneSample`, `PhoneWithdraw`, `PhoneReading`,
`RecordPhone`, `EvidencePhone`.

### Scope

Scan (LAB-05) to a sample or record summary with actions; withdraw with a
numeric keypad, remaining volume and destination (LAB-01); record a reading
into a planned sheet row with range check, dilution calculation and photo
attachment (DSET-01); evidence summary (REV-04); record view for model records
(MDL-04).

### Exit

Each flow completes one-handed on a phone in a browser test at 390×844, writes
through the same RPCs as desktop, and is recorded in History.
