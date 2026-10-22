"""Typed dataclass models for Sheetbase resources.

These models mirror the row schemas in docs/api/openapi/external-api-v0.json.
They are plain dataclasses with ``from_dict`` class methods that handle
snake_case JSON → Python field mapping. Optional/nullable fields default
to ``None``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sheetbase.errors import StaleVersionError, ValidationError


def _parse_dt(v: Optional[str]) -> Optional[datetime]:
    if v is None:
        return None
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


@dataclass(frozen=True)
class Project:
    id: UUID
    workspace_id: UUID
    key: str
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    custom_fields: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Project:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            key=d["key"],
            title=d["title"],
            status=d["status"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            archived_at=_parse_dt(d.get("archived_at")),
            custom_fields=d.get("custom_fields") or {},
        )


@dataclass(frozen=True)
class Record:
    id: UUID
    workspace_id: UUID
    kind: str
    identifier: str
    title: str
    status: str
    tags: list[str]
    structure_version: int
    metadata_version: int
    created_at: datetime
    updated_at: datetime
    created_by_user_id: str
    calculation_input_revision: int
    properties: dict[str, Any]
    custom_fields: dict[str, Any]
    project_id: Optional[UUID] = None
    folder_id: Optional[UUID] = None
    archived_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    updated_by_user_id: Optional[str] = None
    updated_by_credential_id: Optional[UUID] = None
    locked_at: Optional[datetime] = None
    locked_by_revision_id: Optional[UUID] = None
    source_notebook_template_version_id: Optional[UUID] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Record:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            kind=d["kind"],
            identifier=d["identifier"],
            title=d["title"],
            status=d["status"],
            tags=d.get("tags") or [],
            structure_version=d["structure_version"],
            metadata_version=d["metadata_version"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            created_by_user_id=d["created_by_user_id"],
            calculation_input_revision=d["calculation_input_revision"],
            properties=d.get("properties") or {},
            custom_fields=d.get("custom_fields") or {},
            project_id=UUID(d["project_id"]) if d.get("project_id") else None,
            folder_id=UUID(d["folder_id"]) if d.get("folder_id") else None,
            archived_at=_parse_dt(d.get("archived_at")),
            deleted_at=_parse_dt(d.get("deleted_at")),
            updated_by_user_id=d.get("updated_by_user_id"),
            updated_by_credential_id=UUID(d["updated_by_credential_id"]) if d.get("updated_by_credential_id") else None,
            locked_at=_parse_dt(d.get("locked_at")),
            locked_by_revision_id=UUID(d["locked_by_revision_id"]) if d.get("locked_by_revision_id") else None,
            source_notebook_template_version_id=UUID(d["source_notebook_template_version_id"]) if d.get("source_notebook_template_version_id") else None,
        )


@dataclass(frozen=True)
class Dataset:
    id: UUID
    workspace_id: UUID
    schema_version_id: UUID
    name: str
    lifecycle: str
    revision: int
    created_at: datetime
    updated_at: datetime
    primary_project_id: Optional[UUID] = None
    description: Optional[str] = None
    created_by_user_id: Optional[str] = None
    created_by_credential_id: Optional[UUID] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Dataset:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            schema_version_id=UUID(d["schema_version_id"]),
            name=d["name"],
            lifecycle=d["lifecycle"],
            revision=d["revision"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            primary_project_id=UUID(d["primary_project_id"]) if d.get("primary_project_id") else None,
            description=d.get("description"),
            created_by_user_id=d.get("created_by_user_id"),
            created_by_credential_id=UUID(d["created_by_credential_id"]) if d.get("created_by_credential_id") else None,
        )


@dataclass(frozen=True)
class DatasetVersion:
    id: UUID
    workspace_id: UUID
    dataset_id: UUID
    schema_version_id: UUID
    label: str
    source_dataset_revision: int
    created_at: datetime
    created_by_user_id: Optional[str] = None
    created_by_credential_id: Optional[UUID] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DatasetVersion:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            dataset_id=UUID(d["dataset_id"]),
            schema_version_id=UUID(d["schema_version_id"]),
            label=d["label"],
            source_dataset_revision=d["source_dataset_revision"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            created_by_user_id=d.get("created_by_user_id"),
            created_by_credential_id=UUID(d["created_by_credential_id"]) if d.get("created_by_credential_id") else None,
        )


@dataclass(frozen=True)
class RecordModel:
    """A workspace-defined record model identity (ADR-0051).

    Built-in kinds stay in the migration-owned model catalogue; these rows are
    workspace-owned and GET-only for external credentials.
    """

    id: UUID
    workspace_id: UUID
    key: str
    name: str
    identifier_prefix: str
    lifecycle: str
    current_version: int
    created_at: datetime
    updated_at: datetime
    description: Optional[str] = None
    created_by_user_id: Optional[str] = None
    updated_by_user_id: Optional[str] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RecordModel:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            key=d["key"],
            name=d["name"],
            identifier_prefix=d["identifier_prefix"],
            lifecycle=d["lifecycle"],
            current_version=d["current_version"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            description=d.get("description"),
            created_by_user_id=d.get("created_by_user_id"),
            updated_by_user_id=d.get("updated_by_user_id"),
        )


@dataclass(frozen=True)
class SchemaField:
    """A field definition within a dataset schema version.

    ``field_id`` is the stable identifier used as the column key in row
    ``values`` dicts and DataFrame columns; ``label`` is the human-readable
    name suitable for analysis surfaces.
    """

    id: UUID
    schema_version_id: UUID
    field_id: UUID
    key: str
    label: str
    logical_type: str
    nullable: bool
    cardinality: str
    lifecycle: str
    display_order: int
    description: Optional[str] = None
    default_value: Optional[Any] = None
    validation: Optional[Any] = None
    category: Optional[Any] = None
    relationship: Optional[Any] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SchemaField:
        return cls(
            id=UUID(d["id"]),
            schema_version_id=UUID(d["schema_version_id"]),
            field_id=UUID(d["field_id"]),
            key=d["key"],
            label=d["label"],
            logical_type=d["logical_type"],
            nullable=d["nullable"],
            cardinality=d["cardinality"],
            lifecycle=d["lifecycle"],
            display_order=d["display_order"],
            description=d.get("description"),
            default_value=d.get("default_value"),
            validation=d.get("validation"),
            category=d.get("category"),
            relationship=d.get("relationship"),
        )


@dataclass(frozen=True)
class RecordRevision:
    """An immutable record revision with its integrity digest.

    Revisions are the audit/provenance trail for a record. ``canonical_snapshot``
    and ``integrity_digest`` describe the frozen revision content; they are
    distinct from live record state.
    """

    id: UUID
    record_id: UUID
    workspace_id: UUID
    structure_version: int
    metadata_version: int
    reason: str
    created_at: datetime
    updated_at: datetime
    created_by_user_id: str
    metadata_snapshot: dict[str, Any] = field(default_factory=dict)
    block_snapshot: Optional[dict[str, Any]] = None
    canonical_snapshot: Optional[dict[str, Any]] = None
    integrity_algorithm: Optional[str] = None
    integrity_digest: Optional[str] = None
    superseded_by_revision_id: Optional[UUID] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RecordRevision:
        return cls(
            id=UUID(d["id"]),
            record_id=UUID(d["record_id"]),
            workspace_id=UUID(d["workspace_id"]),
            structure_version=d["structure_version"],
            metadata_version=d["metadata_version"],
            reason=d["reason"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            created_by_user_id=d["created_by_user_id"],
            metadata_snapshot=d.get("metadata_snapshot") or {},
            block_snapshot=d.get("block_snapshot"),
            canonical_snapshot=d.get("canonical_snapshot"),
            integrity_algorithm=d.get("integrity_algorithm"),
            integrity_digest=d.get("integrity_digest"),
            superseded_by_revision_id=(
                UUID(d["superseded_by_revision_id"])
                if d.get("superseded_by_revision_id")
                else None
            ),
        )


@dataclass(frozen=True)
class DatasetRow:
    """A single row from ``query_dataset_rows`` or ``query_dataset_version_rows``."""

    row_id: UUID
    revision: int
    values: dict[str, Any]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DatasetRow:
        return cls(
            row_id=UUID(d["rowId"]),
            revision=d["revision"],
            values=d.get("values") or {},
        )


@dataclass(frozen=True)
class SheetInstance:
    id: UUID
    workspace_id: UUID
    name: str
    revision: int
    created_at: datetime
    updated_at: datetime
    notebook_record_id: Optional[UUID] = None
    sheet_definition_version_id: Optional[UUID] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SheetInstance:
        return cls(
            id=UUID(d["id"]),
            workspace_id=UUID(d["workspace_id"]),
            name=d["name"],
            revision=d["revision"],
            created_at=_parse_dt(d["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(d["updated_at"]),  # type: ignore[arg-type]
            notebook_record_id=UUID(d["notebook_record_id"]) if d.get("notebook_record_id") else None,
            sheet_definition_version_id=UUID(d["sheet_definition_version_id"]) if d.get("sheet_definition_version_id") else None,
        )


@dataclass(frozen=True)
class SearchResult:
    result_type: str
    record_id: UUID
    kind: str
    identifier: str
    title: str
    total_count: int
    status: Optional[str] = None
    project_id: Optional[UUID] = None
    archived: Optional[bool] = None
    created_by_user_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    matched_context: Optional[str] = None
    matched_field: Optional[str] = None
    rank: Optional[float] = None
    deep_link: Optional[str] = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SearchResult:
        return cls(
            result_type=d["result_type"],
            record_id=UUID(d["record_id"]),
            kind=d["kind"],
            identifier=d["identifier"],
            title=d["title"],
            total_count=d["total_count"],
            status=d.get("status"),
            project_id=UUID(d["project_id"]) if d.get("project_id") else None,
            archived=d.get("archived"),
            created_by_user_id=d.get("created_by_user_id"),
            created_at=_parse_dt(d.get("created_at")),
            updated_at=_parse_dt(d.get("updated_at")),
            matched_context=d.get("matched_context"),
            matched_field=d.get("matched_field"),
            rank=d.get("rank"),
            deep_link=d.get("deep_link"),
        )


@dataclass(frozen=True)
class CommitResult:
    """Result of ``commit_dataset_row_batch``."""

    ok: bool
    dataset_id: UUID
    dataset_revision: int
    rows: list[dict[str, Any]]
    idempotent: bool

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CommitResult:
        # Batch validation refusals are HTTP 200, not transport errors.
        # A row conflict cannot be repaired by rereading the dataset revision.
        if d.get("ok") is False:
            errors = d.get("errors") or []
            if any(error.get("code") == "stale_dataset_revision" for error in errors):
                raise StaleVersionError("stale_version", json.dumps(errors))
            raise ValidationError("validation_error", json.dumps(errors))
        return cls(
            ok=d["ok"],
            dataset_id=UUID(d["datasetId"]),
            dataset_revision=d["datasetRevision"],
            rows=d.get("rows") or [],
            idempotent=d["idempotent"],
        )


@dataclass(frozen=True)
class ValidationFailure:
    """A single validation error from ``validate_dataset_row_batch``."""

    row_index: Optional[int] = None
    row_id: Optional[UUID] = None
    field_id: Optional[UUID] = None
    code: Optional[str] = None
    expected_revision: Optional[int] = None
    actual_revision: Optional[int] = None


@dataclass(frozen=True)
class ValidationResult:
    """Result of ``validate_dataset_row_batch``."""

    ok: bool
    errors: list[ValidationFailure] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ValidationResult:
        return cls(
            ok=d.get("ok", False),
            errors=[
                ValidationFailure(
                    row_index=e.get("rowIndex"),
                    row_id=UUID(e["rowId"]) if e.get("rowId") else None,
                    field_id=UUID(e["fieldId"]) if e.get("fieldId") else None,
                    code=e.get("code"),
                    expected_revision=e.get("expectedRevision"),
                    actual_revision=e.get("actualRevision"),
                )
                for e in d.get("errors") or []
            ],
        )
