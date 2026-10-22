"""Develop a pipeline step locally, save it as a draft, then run and inspect the published pipeline.

A draft is not runnable: a person reviews and publishes it in Sheetbase. Once a
version is published, trigger it with the pipeline's webhook secret and read what
the Python step printed (and the line it failed on) from the run logs.

Saving a draft needs a personal token with ``pipelines:read`` and ``pipelines:write``.
"""

from pathlib import Path

from sheetbase import SheetbaseClient

BASE_URL = "https://app.sheetbase.co.uk"
CREDENTIAL = "sb_01234567_..."
WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440001"
PIPELINE_ID = "880e8400-e29b-41d4-a716-446655440030"
WEBHOOK_SECRET = "..."  # shown once when the pipeline's webhook is enabled


def main() -> None:
    with SheetbaseClient(
        base_url=BASE_URL,
        credential=CREDENTIAL,
        scopes=["pipelines:read", "pipelines:write"],
    ) as client:
        version, created = client.pipelines.sync_step(
            workspace_id=WORKSPACE_ID,
            definition_id=PIPELINE_ID,
            code=Path("analysis.py").read_text(encoding="utf-8"),
            step="analyse",
            requirements=["pandas==2.2.2"],
        )
        print("Created a new draft." if created else "Updated the open draft.", version)

        run = client.pipelines.trigger(
            definition_id=PIPELINE_ID,
            webhook_token=WEBHOOK_SECRET,
            idempotency_key="push-step-example-1",
            parameters={"study": "S1"},
        )
        settled = client.pipelines.wait_for_run(run["runId"])
        print(f"Run {settled['id']} {settled['status']}")
        for entry in client.pipelines.run_logs(run["runId"]):
            for line in entry["detail"].get("logs", []):
                print(f"  [{entry['stage']}] {line}")
            if "line" in entry["detail"]:
                print(f"  failed at line {entry['detail']['line']}")


if __name__ == "__main__":
    main()
