# INT — Integrations

**Status (2026-09-07):** INT-01..03 active scope recorded closed on `main`, within the representative instrument/S3/read-only PostgreSQL contracts. The candidate vendor list below is not a delivered connector catalogue. See the [reconciled task index](README.md) and [`../../NEXT.md`](../../../../NEXT.md); this reconciliation does not independently re-certify every exit.

## Programme goal

Provide a generic, observable integration contract before accumulating instrument- or vendor-specific one-offs.

## INT-01 — Generic Connector Framework

Connector identity/type; credentials; inbound/outbound direction; mapping; manual/scheduled/event-driven runs; execution history; retries; errors; provenance; observability; capability model; secrets; connector SDK/interface.

**Exit:** new integrations can be implemented without inventing a new execution/security model each time.

## INT-02 — Scientific Instrument Ingestion

Use the connector/import framework for instrument outputs. Potential future targets include plate readers, PCR systems, sequencers, balances, chromatography and automation platforms.

Capabilities may include file watching/upload, parser/version identity, metadata extraction, mapping, validation, raw-file retention and resulting Dataset provenance.

**Exit:** at least one representative instrument flow proves the generic framework end-to-end.

## INT-03 — Enterprise/Data Platform Integrations

Candidates: S3-compatible storage, SharePoint/OneDrive, data warehouses/lakehouses, LIMS, MES, ERP or identity systems based on demand.

**Status: implemented** (2026-08). Two representative connector types — generic S3-compatible object storage and a read-only external PostgreSQL database — proven through the INT-01 framework (same credentials, execution, provenance and observability model). See `docs/subsystems/integrations.md` "Enterprise connectors". Future enterprise classes (warehouses, SharePoint/OneDrive, LIMS/MES) plug into the same `EnterpriseConnectorAdapter` seam; none are implemented.

**Exit:** enterprise connectors use the same credentials, execution, provenance and observability model. **Met** for the two representative types.

## Boundaries

- Do not start with a catalogue of bespoke instrument screens.
- Raw scientific files should remain identifiable and retain provenance.
- Connectors must not bypass canonical Dataset/Record validation.
- Credentials belong in secure secret handling, not configuration JSON exposed to clients.
