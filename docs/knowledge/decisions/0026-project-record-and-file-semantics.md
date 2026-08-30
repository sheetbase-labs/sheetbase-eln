# ADR 0026 — Project Scope, Record Identity and File Artifacts

- Status: Accepted
- Date: 2026-08-13
- Related: ADRs 0023–0025

## Project semantics

A Project is primarily an organisational and permission context, not the exclusive owner of scientific identity.

Records and Datasets may be referenced by multiple Projects within the Organisation when permissions allow. Moving/reorganising an object does not change its underlying identity.

Objects may have a primary Project/context for navigation where useful, but this does not imply that cross-Project scientific reuse requires duplication.

## Record identity and naming

Record identity has three distinct concepts:

```text
internal UUID   durable machine identity used by relationships
Record ID       human scientific/business identifier, e.g. LV-000184
Name            descriptive user-facing name; not necessarily unique
```

Relationships store the durable UUID, never Name or display label.

Models may define configurable Record-ID policies. Expected modes include generated, user-supplied, and generated-with-authorised-override.

Generated policies may use prefixes, sequences and formatting. Uniqueness normally applies within Model + Organisation unless an explicit Model policy requires a different scope.

Renaming a Record does not change its UUID or Record ID. Record-ID mutation, where allowed at all, is a separate governed operation from Name editing.

## File Artifacts

Use one common File Artifact identity rather than independent NotebookAttachment, RecordFile, InstrumentFile and PipelineFile storage models.

Conceptually:

```text
FileArtifact
  id
  storage_object/key
  filename
  media_type
  size
  checksum
  created_by
  created_at
  provenance
```

Binary content lives in object storage. PostgreSQL remains authoritative for metadata, identity, permissions/provenance and relationships.

A File Artifact can be related to multiple contexts:

```text
Notebook -----+
Record -------+
Dataset ------+--> File Artifact
Instrument ---+
Pipeline Run -+
```

`Attachment` is a contextual relationship/use of a File Artifact, not a separate binary identity.

Scientific/raw input files should support checksum-based integrity and immutable/raw-file semantics where appropriate. The same raw binary may be referenced from an Instrument Run, Pipeline Run and Notebook without duplicating its identity.

## Comments and annotations

Detailed annotation semantics are intentionally deferred. The only current direction is to avoid creating unrelated comment architectures for every feature. When collaboration/review work requires it, design a generic annotation model targeting stable object identities; cell/value-level semantics should be decided then.

## Constraints

1. Project membership/context does not redefine Record/Dataset identity.
2. Cross-Project reuse within an Organisation does not require object duplication solely for ownership reasons.
3. UUID, human Record ID and Name remain distinct.
4. Relationships use UUIDs.
5. Record-ID generation is Model-configurable and server-authoritative.
6. Files use one durable File Artifact identity with contextual relationships.
7. Raw scientific file integrity/provenance must be preservable.
8. Do not implement separate binary-storage concepts per product module.
