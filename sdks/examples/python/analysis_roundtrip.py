"""Analysis round-trip — a representative scientific workflow.

1. Download a dataset into a pandas DataFrame (field labels resolved from the
   dataset schema version).
2. Analyse the data locally.
3. Upload derived results as new rows using canonical field IDs.
4. Snapshot an immutable Dataset Version so the analysed state is frozen
   evidence, not just audit history.

Field IDs (stable UUIDs) remain the durable identifiers; labels are display
convenience only.
"""

from sheetbase import SheetbaseClient

BASE_URL = "https://app.sheetbase.co.uk"
CREDENTIAL = "sb_01234567_..."
DATASET_ID = "770e8400-e29b-41d4-a716-446655440020"

# Canonical field IDs from the dataset's schema version.
SOURCE_TITER_FIELD = "fff00000-0000-0000-0000-000000000001"
DERIVED_LOG_TITER_FIELD = "fff00000-0000-0000-0000-000000000003"


def main() -> None:
    with SheetbaseClient(
        base_url=BASE_URL,
        credential=CREDENTIAL,
        scopes=["datasets:read", "datasets:write"],
    ) as client:
        dataset = client.datasets.get(DATASET_ID)

        # 1. Download live rows with human-readable column labels.
        labels = client.datasets.field_label_map(str(dataset.schema_version_id))
        df = client.datasets.to_dataframe(DATASET_ID, field_labels=labels)
        print(f"Downloaded {len(df)} rows at dataset revision {dataset.revision}")

        # 2. Analyse locally — pure pandas, no business rules duplicated.
        titer_column = labels[SOURCE_TITER_FIELD]
        df["log10_titer"] = df[titer_column].map(lambda v: __import__("math").log10(v))

        # 3. Upload derived values as new rows (stable field IDs, not labels).
        results = client.datasets.upload_dataframe(
            DATASET_ID,
            expected_revision=dataset.revision,
            df=df[[DERIVED_LOG_TITER_FIELD]].rename(
                columns={DERIVED_LOG_TITER_FIELD: DERIVED_LOG_TITER_FIELD}
            ),
        )
        final_revision = results[-1].dataset_revision
        print(f"Committed derived rows; dataset now at revision {final_revision}")

        # 4. Freeze the analysed state as an immutable Dataset Version.
        version = client.datasets.snapshot(
            DATASET_ID,
            expected_revision=final_revision,
            label="log-titer analysis",
        )
        print(f"Frozen version {version.id} pins revision {version.source_dataset_revision}")


if __name__ == "__main__":
    main()
