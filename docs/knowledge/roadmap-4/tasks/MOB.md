# MOB — Phone at the Bench

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#mob) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below. Depends on WORK-01, LAB-01 and LAB-05.

## Programme goal

A scientist with gloves on and a phone in hand can see today's work, scan a
label, withdraw volume and record a reading, and nothing else gets in the way.

## Baseline at `main` `9538f36`

The app is responsive to tablet width through the NAV-01 drawer; there is no
phone layout, no camera scanning and no bench-specific flow.

## MOB-01 — Phone shell

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#mob-01).

**Original decision/dependency note:** Original proposal. The UI port added the phone bottom bar (Today, Scan, Inbox, Menu), the drawer, and the inspector/dialog bottom sheets; `tests/browser-scripts/phone.mjs` checks them at 390, 834 and 1100. Today/Inbox compact content and the 600px phone-bar back button remain.

### Design

`canvas/PhoneHome.dc.html`, `canvas/PhoneInbox.dc.html`,
`design-system/components/Navigation/README.md` (phone tabs).

### Scope

Below 600px the shell becomes a phone bar and a three-item bottom bar (Today,
Scan, Inbox); 44px minimum targets; Today shows your bookings and items that
need you; Inbox lists WORK-01 items, with review and signing sending you to
the full record on a larger screen. Same routes and data as desktop.

### Start here

The shell from SHELL-01 (`src/components/shell/`), WORK-01 data module,
`src/lib/calendar.ts` (today's bookings). Design: render `PhoneHome`,
`PhoneInbox` (390×844).

### Steps (PRs)

1. Phone layout below 600px in the shell: `phone-bar` header with back button,
   bottom bar (Today, Scan, Inbox), 44px targets, no sidebar or inspector.
2. `/` renders Today on phones (bookings, needs-you items); `/inbox` renders the
   compact list; review and signing items link to the full record with a note
   that they need a larger screen.

### Check it

Playwright with the iPhone-sized viewport; parity for both boards.

### Exit

Today and Inbox match the design at 390×844 on seeded data and pass touch
target and contrast checks.

## MOB-02 — Bench flows

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#mob-02).

**Original decision/dependency note:** Original proposal. The UI port added `/scan` (typed and camera lookup of canonical identifiers, result card with an open action); withdraw, record reading and the evidence/model record phone views remain.

### Design

`canvas/PhoneScan.dc.html`, `PhoneSample`, `PhoneWithdraw`, `PhoneReading`,
`RecordPhone`, `EvidencePhone`.

### Scope

Scan (LAB-05) to a sample or record summary with actions; withdraw with a
numeric keypad, remaining volume and destination (LAB-01); record a reading
into a planned sheet row with range check, dilution calculation and photo
attachment (DSET-01); evidence summary (REV-04); record view for model records
(MDL-04).

### Start here

LAB-01 (withdraw RPC), LAB-05 (scan and labels), DSET-01 (planned rows),
REV-04 (evidence), MDL-04 (model records). Design: render `PhoneScan`,
`PhoneSample`, `PhoneWithdraw`, `PhoneReading`, `RecordPhone`, `EvidencePhone`.

### Steps (PRs)

1. `/scan` route: camera scan (from LAB-05) and typed ID fallback; result card
   with actions.
2. Phone sample view and withdraw flow with numeric keypad component
   (`src/components/phone/keypad.tsx`), remaining volume, destination.
3. Record-a-reading: pick the planned row, enter value, range check,
   dilution calculation shown, optional photo (upload via the file routes).
4. Phone evidence and model record views.

### Check it

Browser tests at 390×844 for each flow writing through the same RPCs as
desktop; parity for the six boards.

### Exit

Each flow completes one-handed on a phone in a browser test at 390×844, writes
through the same RPCs as desktop, and is recorded in History.
