# 0053. Instrument intake methods are configuration, not integrations

- **Status:** accepted
- **Date:** 2026-10-11
- **Ticket:** Roadmap 5, R5-CONFIG-02
- **Relates to:** ADR-0037 canonical dataset storage and versioning (DSET-05/06 import provenance)

## Context

The instrument registry could record what an instrument is, where it sits and
who owns it, but not **how its data arrives**. The design's register dialog asks
"How data gets in" (file drop, webhook, manual entry, not connected yet) and the
inspector shows method, health, last data and next booking, with an explicit
"parser not validated" follow-up. Without a recorded method, "health" could only
be a single `last_connected_at` timestamp that nothing in the product ever
writes, and a screen showing "Disconnected" for every instrument claimed
knowledge it did not have.

The temptation is a connector registry: a catalogue of integrations keyed by
instrument. That would duplicate the generic connector framework (INT-01) and
the dataset import path (DSET-05/06), and would make a one-word configuration
choice look like a new subsystem.

## Decision

1. **The method is instrument configuration.** One column,
   `api.instruments.intake_method`, holds `filedrop`, `webhook`, `manual` or
   `none`, constrained in SQL and written through `create_instrument` and
   `set_instrument_intake_method` (writer-gated). There is no connector
   registry, and no per-method table.

2. **Each method names who writes the data, and therefore its provenance.**
   - `filedrop` — the instrument or its PC writes export files; they arrive
     through a parser and become `dataset_imports` with the parser and source
     provenance frozen at commit.
   - `webhook` — the instrument's software posts results; the import again
     carries its own frozen provenance (and connector-run evidence where the
     generic connector framework is the writer).
   - `manual` — a person types the reading in; the entering user is the
     provenance.
   - `none` — registration for booking and citing only; nothing arrives.

3. **Automated methods require a validated parser, and the screen says so.**
   `filedrop` and `webhook` cannot import into a GxP dataset until a parser with
   a validated or approved version is attached. While none is, the instrument's
   health reads "Parser not validated" and the inspector states that readings
   cannot be imported into a GxP dataset — rather than showing a healthy
   connector that has never delivered anything.

4. **Health is per method, from real evidence.** `manual` and `none` report what
   they are. An automated method is healthy only with a committed import to
   prove it; the latest import's status and age decide between "waiting for
   first data", "last import failed", "healthy" and "no data for n days". No
   heartbeat is invented.

5. **Changing the method rewrites no history.** It is configuration for future
   data. An import keeps the parser and source provenance it was committed
   with; the method is deliberately absent from the frozen revision evidence
   (LAB-06.4 captures instrument identity and name only), so a change produces
   no drift and no instrument-history event (`internal.instrument_change_event`
   tracks name, location and qualified-for).

## Consequences

- Adding a method is a constraint change plus one column, not an integration.
- "Last data" and "next booking" are derived from `dataset_imports` and
  `calendar_bookings` (the resource whose metadata names the instrument), so an
  instrument with no calendar resource reads "Not bookable" instead of "free".
- The legacy `connection_status` / `last_connected_at` columns remain in the
  table for the surfaces that still read them (the scan resolver) but no
  instrument screen derives health from them any more; a future ticket may
  retire them.
- The method is not evidence: it cannot be cited as proof that data arrived, and
  a GxP claim rests on the frozen import provenance, never on this column.
