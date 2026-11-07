# Build an extension

A short guide to an extension that adds work to Sheetbase. The full contract is
in [the extensions API page](../api/extensions-api.md). The runnable example is
`src/lib/extensions/sample/tools.ts`: one extension with a pipeline action, a
read tool, a write tool and an analysis kind.

## Try the sample

1. Sign in as an owner or admin and open Settings → Extensions.
2. Add an extension → Use the sample → Install, then switch it on.
3. The Python parts need the pipeline Python runner. Locally, run the worker in
   `docker/pipeline-python` and set `PIPELINE_PYTHON_RUNNER_URL` and its token.
4. Ask the assistant for dilution volumes, add the summary step to a pipeline,
   or run “Moving average” from an analysis block.

## Write your own

1. Write a manifest with `id`, `name`, `version`, `source`, `capabilities`,
   `scopes` and the `contributions` you need. Paste it into the install dialog;
   it is validated before anything is saved and each problem is named.
2. Pick a runner per item. Python is simplest: define `run(input)` and return
   an object whose keys match your declared `outputs`.
3. For a service of your own, use a webhook runner, then make a signing key in
   Settings → Extensions and verify each call:

```python
import hmac, hashlib, time

def verify(secret: str, timestamp: str, body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    fresh = abs(time.time() - int(timestamp)) < 300
    return fresh and hmac.compare_digest(expected, header)
```

Answer `{"output": {...}}`. 4. Mark anything that changes data as a `write` tool. People get a confirm card,
and agents go through the approval policy. Do not expect to sign or approve
anything: extensions cannot. 5. Switch points off per extension from the Extensions list to try the
fail-closed behaviour; removing the extension removes everything it added.

## Tests

Manifest rules: `src/lib/extensions/runner-points.test.ts`. SQL parity:
`tests/db/extension-tool-points.test.ts`.
