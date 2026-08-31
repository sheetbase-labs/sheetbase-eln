"""Frozen-evidence read path — reconstruct what was recorded, not what is live.

Dataset Versions are immutable snapshots pinned to a source revision. This
example lists a dataset's versions, downloads a frozen version as a DataFrame,
and compares it against the live rows without mutating anything. Frozen
figures and submitted analyses should always reconstruct from versions, never
from shifting live data.
"""

from sheetbase import SheetbaseClient

BASE_URL = "https://app.sheetbase.co.uk"
CREDENTIAL = "sb_01234567_..."
DATASET_ID = "770e8400-e29b-41d4-a716-446655440020"


def main() -> None:
    with SheetbaseClient(
        base_url=BASE_URL,
        credential=CREDENTIAL,
        scopes=["datasets:read"],
    ) as client:
        dataset = client.datasets.get(DATASET_ID)
        labels = client.datasets.field_label_map(str(dataset.schema_version_id))

        # List the frozen versions, newest first.
        versions = client.datasets.list_versions(DATASET_ID)
        print(f"Dataset '{dataset.name}' has {len(versions)} frozen version(s):")
        for version in versions:
            print(
                f"  - {version.label} (pins revision {version.source_dataset_revision}, "
                f"created {version.created_at.isoformat()})"
            )

        if not versions:
            print("No frozen versions yet — snapshot the dataset first.")
            return

        # Download the newest frozen version and the live rows.
        frozen = client.datasets.version_to_dataframe(
            str(versions[0].id), field_labels=labels
        )
        live = client.datasets.to_dataframe(DATASET_ID, field_labels=labels)

        print(f"Frozen version rows: {len(frozen)}")
        print(f"Live rows:           {len(live)}")

        # Compare a labelled column between the frozen and live views.
        shared = [c for c in frozen.columns if c in live.columns and c not in ("row_id", "revision")]
        for column in shared:
            changed = not frozen[column].equals(live[column]) if column in live else True
            print(f"  {column}: {'changed since freeze' if changed else 'unchanged since freeze'}")


if __name__ == "__main__":
    main()
