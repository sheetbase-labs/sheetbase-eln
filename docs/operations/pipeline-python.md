# Isolated Python pipeline runtime

Python steps call `transform(inputs, parameters)` once with the pinned input rows
and run parameters. They return a list of dictionaries or a pandas DataFrame.
The app commits the returned rows through the existing Pipeline execution path.
Python does not receive database credentials or write to Sheetbase directly.

```python
import pandas as pd
import numpy as np
from scipy import stats

def transform(inputs, parameters):
    readings = pd.DataFrame(inputs["readings"])
    return [{
        "mean": float(np.mean(readings["value"])),
        "median": float(stats.scoreatpercentile(readings["value"], 50)),
        "study": parameters["study"],
    }]
```

Input values retain their JSON representation. Decimal/date strings remain
strings until the code explicitly converts them. Returned dates and NumPy scalar
values are JSON-encoded; NaN and infinity fail the step instead of silently
becoming null. Use `None` for an intended missing value. DataFrame columns must
be unique strings. Print output is captured as run logs, limited to 64 KiB;
logs may contain input values, so avoid printing sensitive scientific data.

## Boundaries and limits

The server-only `executePythonTransform` client calls the trusted runner over a
private HTTP connection (or HTTPS when crossing a host boundary). Only that
runner has Docker access. The app must never mount a Docker socket. The bearer
token is server-only and must never be included in pipeline definitions or
browser responses.

Each job creates a fresh container from the runner's one configured immutable
image. Requests cannot select commands, mounts, networks, users or environment
variables. The job receives only JSON on stdin. Its container uses:

- no network, a read-only root filesystem and UID/GID 65532;
- no capabilities, no new privileges and Docker's default seccomp profile;
- 1 CPU, 512 MiB memory with no additional swap, and 64 processes;
- a 64 MiB ephemeral `/tmp` filesystem, without executable files;
- a 60-second execution limit, followed by forced container removal;
- at most 100,000 input/output rows, 256 fields per row, 1,000,000 cells,
  and 32 MiB per request/result. Inputs are limited across all aliases together.

Rows are never silently truncated. The runner accepts at most two concurrent
jobs and fails closed after a container cleanup failure; resolve the Docker
problem and restart the runner before accepting further work. Docker creation
and removal each have an additional 10-second bound. The app's request deadline
is 90 seconds to cover orchestration around the 60-second transform.

The trusted runner has Docker control-plane access: keep it on the private app
network and do not expose its port through the public tunnel. The runtime image
must contain no credentials. No host directories are mounted into job containers.

## Images

Build the worker from an immutable Python 3.12 slim Bookworm base image:

```sh
docker build -f docker/pipeline-python/Dockerfile \
  --build-arg PYTHON_IMAGE='python:3.12-slim-bookworm@sha256:<verified-digest>' \
  -t sheetbase-pipeline-python:build .
docker image inspect sheetbase-pipeline-python:build --format '{{json .RepoDigests}}'
```

`requirements.txt` pins NumPy 2.2.6, pandas 2.2.3, SciPy 1.15.3 and their
transitive Python dependencies, and `allotropy` 0.1.151 (with its pinned
dependencies), which converts instrument files to the Allotrope Simple Model.
It is used by `converters/allotropy_convert.py`, which the app sends to the
runner when an instrument's parser is an Allotrope converter (see
[instrument-data-api.md](../api/instrument-data-api.md)). Package installation happens only while building
the image. Runtime jobs cannot install packages from a network. Publish the
reviewed image through the normal authorized image-delivery flow and configure
its `repository@sha256:...` reference. A mutable tag is rejected. For local Docker
builds that produce a RepoDigest, that local immutable reference is sufficient.

The runner image has no npm dependencies. Build it using digest-pinned Node 26
Alpine and Docker CLI images:

```sh
docker build -f docker/pipeline-python/runner.Dockerfile \
  --build-arg NODE_IMAGE='node:26-alpine@sha256:<verified-digest>' \
  --build-arg DOCKER_CLI_IMAGE='docker:28-cli@sha256:<verified-digest>' \
  -t sheetbase-pipeline-python-runner:build .
```

The runner runs as UID 65532. Give its trusted service process the Docker socket's
supplementary group when using a socket mount. A dedicated/rootless Docker engine
can instead be reached through the runner's `DOCKER_HOST`. The Python job itself
never receives that socket or environment variable. Verify CPU/memory/pid controls
on the target engine before running scientific jobs.

## Configuration and protocol

| Variable                       | Where            | Meaning                                                                                              |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `PIPELINE_PYTHON_RUNNER_URL`   | App              | Private base URL, e.g. `http://pipeline-python-runner:8080`; no credentials, path, query or fragment |
| `PIPELINE_PYTHON_RUNNER_TOKEN` | App and runner   | Matching random bearer secret, at least 32 characters                                                |
| `PIPELINE_PYTHON_IMAGE`        | Runner           | Installed immutable worker image reference                                                           |
| `PIPELINE_PYTHON_RUNNER_PORT`  | Runner           | Listening port; default 8080                                                                         |
| `PIPELINE_PYTHON_RUNNER_HOST`  | Runner           | Listen address; default 0.0.0.0 inside its private network                                           |
| `DOCKER_HOST`                  | Runner, optional | Trusted Docker engine endpoint                                                                       |

For a local host process, set the bind address to `127.0.0.1`, provide only the
required runner variables and PATH, then run
`node scripts/pipeline-python-runner.mjs`. Do not source the app's environment
file into the runner.

The protocol has these bearer-authenticated endpoints:

- `GET /runtime` verifies the configured image is installed and returns
  `{ "runtime": "repository@sha256:...", "python"?, "packages"? }` for definition
  authoring. The interpreter version and installed packages come from running
  the worker's `inspect` mode once in the same locked-down container; they are
  omitted, not an error, if that cannot be read.
- `POST /execute` receives
  `{ statement, inputs, parameters, runtime?, requirements?, contract? }` and
  returns `{ rows, logs, runtime, files, environment? }`. A failure returns
  `{ error, code, logs?, line? }`. When supplied, `runtime` must match the
  runner's fixed image before any container is created. Pipeline execution must
  supply the saved definition's runtime pin; changing the installed image does
  not silently change the meaning of an existing definition.

- `POST /environments` with `{ "requirements": ["rdkit>=2024.3"] }` starts (or
  finds) the build of a plugin's packages and answers `{ id, state }` with
  `200` when ready and `202` while building. `GET /environments/<id>` answers
  `{ id, state, error?, packages? }`.
- `POST /execute` also takes `limits`, `environment` and `network` for a plugin
  call (see above). `limits` is `{ timeoutSeconds, memoryMb, cpus, processes,
scratchMb, bytes, rows }`.

`getPythonRuntime()` exposes only the installed immutable identity.
`executePythonTransform()` throws `PipelinePythonError` on unavailable runners,
validation failures, execution errors, size limits or timeouts. There is no
in-process or unsandboxed fallback. Error text and captured logs are untrusted
scientist-provided content and should be rendered as text.

## Plugin Python

Plugins (Settings → Plugins) run in this same broker, with three differences
from a pipeline step. None of them is a fixed limit: each is a per-plugin
setting an administrator controls in the app.

**Packages.** A plugin declares the pip packages it needs in `plugin.json`
(`python.requirements`: anything pip understands, such as `rdkit>=2024.3` or
`biopython==1.84`). When an administrator adds the plugin, the app asks the
broker to install them (`POST /environments`). The broker builds an image from
the worker image plus those packages, once per distinct package list: plugins
that need the same packages share it, and a new worker image rebuilds it. A call
never installs anything; it runs from that image, in the same locked-down
container as any step. The build is the only place pip runs and the only place
that needs network.

- The broker needs access to the Docker engine's image store (it already does)
  and outbound access to the package index. Point pip at a mirror with
  `PIPELINE_PYTHON_PIP_INDEX_URL`.
- `PIPELINE_PYTHON_BUILD_TIMEOUT_MINUTES` (default 60) bounds one install. The
  worker image is a slim Python with no compiler, so a package that has to be
  built from source needs a wheel or a mirror that has one.
- The built images are named `sheetbase-plugin-env:<id>` on the host. Remove one
  with `docker image rm` when the plugin that used it is gone; the app asks again
  on the next call if it is still wanted.
- Builds run one at a time. `GET /environments/<id>` reports `ready`, `building`,
  `failed` (with pip's own message) or `missing`.

**Limits.** A plugin call carries its own `limits` (time, memory, cores,
processes, scratch disk, data each way, rows). They replace the pipeline limits
for that call. The defaults and where an administrator changes them are in
[Build a plugin](../development/build-a-plugin.md). The broker has two settings of
its own that are the operator's, not the plugin's:

| Variable                             | Meaning                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `PIPELINE_PYTHON_RUNNER_CONCURRENCY` | Calls running at once, pipeline steps and plugin calls together. Default 4.                                     |
| `PIPELINE_PYTHON_RUNNER_MAX_BODY_MB` | The largest request the broker reads at all. Default 512, which is also about the most one JSON call can carry. |
| `PIPELINE_PYTHON_BROKER_MEMORY`      | Compose only: the broker container's memory. Default 2g; the broker holds a call's data while it passes it on.  |

**Network.** Without the egress overlay a plugin cannot reach anything, and a
plugin that was approved for hosts is refused with a plain message instead of
running without them. With `compose.pipeline-python-egress.yaml` added to the
same `docker compose` command, the broker joins a private Docker network with no
route to the internet and serves an allow-listing proxy on it. A call for a
plugin with approved hosts runs on that network with `HTTP_PROXY` and
`HTTPS_PROXY` set to the proxy and a credential that is good for that call only;
the proxy connects to the approved host names (exact, or `*.example.org` for
sub-domains) on any port and nothing else. It resolves the name itself and
connects to the address it checked, and it refuses an address inside your own
network (loopback, private ranges, link-local) unless
`PIPELINE_PYTHON_EGRESS_ALLOW_PRIVATE=1`. Code that opens a raw socket instead of
honouring the proxy settings simply has no route.

| Variable                               | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `PIPELINE_PYTHON_EGRESS_NETWORK`       | Name of the internal Docker network plugin containers join           |
| `PIPELINE_PYTHON_EGRESS_HOST`          | The broker's name on that network                                    |
| `PIPELINE_PYTHON_EGRESS_PORT`          | Proxy port, default 3128                                             |
| `PIPELINE_PYTHON_EGRESS_BIND`          | Proxy listen address, default 0.0.0.0                                |
| `PIPELINE_PYTHON_EGRESS_ALLOW_PRIVATE` | `1` lets approved hosts resolve to addresses inside your own network |

## Verification

```sh
node_modules/.bin/vitest run src/lib/pipeline-python.server.test.ts
node_modules/.bin/vitest run scripts/pipeline-python-worker.test.ts scripts/pipeline-python-runner-contract.test.ts
node --test scripts/test-pipeline-python-runner.mjs
PIPELINE_PYTHON_TEST_IMAGE='repository@sha256:<installed-image-digest>' \
  node --test scripts/test-pipeline-python-container.mjs
```

The opt-in container suite uses disposable fixtures only. It exercises a real
pandas/NumPy/SciPy transform, scientific value preservation, read-only/nonroot and
network isolation, absent credentials/socket, non-finite output rejection, log
limits, pin mismatch, and actual 60-second timeout cleanup. It needs a functioning
Docker engine; it does not start, stop or mutate the application's services.

References: [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/),
[Docker container options](https://docs.docker.com/reference/cli/docker/container/run/).

## Compose deployment

The optional `compose.pipeline-python.yaml` overlay adds the private broker;
its socket grant belongs only to the broker. No port is published. Install both
reviewed images first, then provide `SHEETBASE_PYTHON_RUNNER_IMAGE` and
`SHEETBASE_PYTHON_IMAGE` as immutable references, the separate matching token,
and `PIPELINE_DOCKER_SOCKET_GID` in the chosen environment's secret configuration.
`PIPELINE_DOCKER_SOCKET` may select a dedicated/rootless engine socket instead
of `/var/run/docker.sock`.

The existing production `deploy.ts --plan/--apply` flow detects these optional
image variables, validates both digests and their local availability, and adds
the overlay. It starts the broker alongside the app and verifies the runtime
identity from inside the app before accepting readiness. With neither image
variable configured, the existing SQL/action-only deployment is unchanged.
The development environment can use the same overlay with `compose.dev.yaml`;
keep its token, broker, Docker resource budget and data separate from production.

This implementation does not publish images or modify VPS configuration. Keep
those activation steps in the approved delivery flow. Existing published Python
versions keep their runtime pin; deploying a different runtime does not upgrade
them automatically.
