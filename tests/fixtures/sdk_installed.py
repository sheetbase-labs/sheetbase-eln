"""Run from an installed wheel, with isolated Python and real HTTP transports."""
import json
import sys
import uuid

from sheetbase import SheetbaseClient
from sheetbase.errors import PermissionDeniedError, NotFoundError, StaleVersionError, ValidationError, TokenError

c = json.loads(sys.stdin.readline())


def refused(error_type, action):
    try:
        action()
    except error_type as error:
        return error
    raise AssertionError(f"Expected {error_type.__name__}")


def pause(stage):
    print(stage, flush=True)
    assert sys.stdin.readline().strip() == "continue"


with SheetbaseClient(c["baseUrl"], c["credential"], c["scopes"]) as client, \
     SheetbaseClient(c["baseUrl"], c["personal"], c["scopes"]) as personal, \
     SheetbaseClient(c["baseUrl"], c["reader"], ["projects:read"]) as reader:
    dataset = c["dataset"]
    initial = client.datasets.query_rows(dataset_id=dataset)
    assert initial.total_count == 0
    rows = [{"operation": "create", "rowId": str(uuid.uuid4()), "values": {c["fieldId"]: 37}}]
    key = str(uuid.uuid4())
    first = client.datasets.commit_rows(dataset, initial.dataset_revision, rows, idempotency_key=key, retry_on_stale=False)
    duplicate = client.datasets.commit_rows(dataset, initial.dataset_revision, rows, idempotency_key=key, retry_on_stale=False)
    assert duplicate.dataset_revision == first.dataset_revision
    assert client.datasets.query_rows(dataset_id=dataset).total_count == 1
    next_rows = [{"operation": "create", "rowId": str(uuid.uuid4()), "values": {c["fieldId"]: 83}}]
    refused(StaleVersionError, lambda: client.datasets.commit_rows(dataset, initial.dataset_revision, next_rows, retry_on_stale=False))
    client.datasets.commit_rows(dataset, initial.dataset_revision, next_rows)
    refused(ValidationError, lambda: client.datasets.commit_rows(dataset, first.dataset_revision + 1, [
        {"operation": "update", "rowId": rows[0]["rowId"], "expectedRevision": 99, "values": {c["fieldId"]: 999}},
    ]))
    assert client.datasets.query_rows(dataset_id=dataset).total_count == 2
    refused(PermissionDeniedError, lambda: reader.datasets.query_rows(dataset_id=dataset))
    refused(NotFoundError, lambda: client.datasets.get(c["hiddenDataset"]))
    refused(PermissionDeniedError, lambda: client.rpc("sign_record"))
    assert personal.datasets.query_rows(dataset_id=dataset).total_count == 2

    pause("permissions")
    assert personal.datasets.query_rows(dataset_id=dataset).total_count == 2
    refused(PermissionDeniedError, lambda: personal.datasets.commit_rows(dataset, first.dataset_revision + 1, [
        {"operation": "create", "rowId": str(uuid.uuid4()), "values": {c["fieldId"]: 999}},
    ], retry_on_stale=False))
    pause("membership")
    refused(PermissionDeniedError, lambda: personal.datasets.query_rows(dataset_id=dataset))
    pause("revocation")
    # Reuse the JWT cached before the credential was revoked.
    refused(PermissionDeniedError, lambda: client.datasets.query_rows(dataset_id=dataset))
    with SheetbaseClient(c["baseUrl"], c["credential"], c["scopes"]) as fresh:
        assert refused(TokenError, lambda: fresh.datasets.query_rows(dataset_id=dataset)).code == "revoked"
print("accepted", flush=True)
