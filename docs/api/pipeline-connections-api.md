# Pipeline connections and web calls

A **web call** step asks another system for data, as one step of a pipeline. It
names a **connection** (an https address an owner, admin or steward approved), a
method and a path, and may name one of the connection's **secrets**. What comes
back is read as rows for the next step.

```yaml
- name: titres
  kind: web_call
  webCall:
    connection: lims
    method: GET
    path: /batches?project={parameters.project}
    secret: LIMS_READ_TOKEN
    itemsPath: items
```

## What a call may do

| Limit     | Rule                                                                                        |
| --------- | ------------------------------------------------------------------------------------------- |
| Address   | https only, no password, query or fragment; the path stays inside the connection's address  |
| Hosts     | Loopback, link-local, unspecified and metadata addresses are always refused, also after DNS |
| Allowlist | The deployment's connector host allowlist applies                                           |
| Time      | 20 seconds a call; a network error, 408, 425, 429 or 5xx is tried again, up to 3 times      |
| Size      | An answer larger than 8 MiB fails the call                                                  |
| Redirects | Followed only inside the same address, at most 3; anywhere else the call fails              |
| Secrets   | Named in the step, never written in it; sent as the connection's auth header, never logged  |
| Recording | The answer is recorded with the run, so a Reproduce reads it again instead of asking        |
| A try     | Sends a GET. A POST is not sent in a try: it reads the last recording of the same request   |

`{parameters.name}` in the path or in a text value of the body is filled in when
the step runs.

## Secrets

A secret is a name and a value sealed beside the connection (AES-256-GCM). A
person with the right to manage integrations types it into **Settings →
Integrations → Pipeline connections** in the app. Nobody can read a value back,
and **no token, MCP call, assistant card or pipeline can set, read or delete
one**. The names are readable on `pipeline_connections.secret_names`.

## Reading connections

`pipeline_connections` is on the token API with `pipelines:read`, so tokens and agents that write pipelines can list and reference connections. It lists `key`,
`name`, `base_url`, `status` (`active` or `off`), the auth header and scheme,
and the secret names.

## Operations

All three need an owner, admin or steward and an `admin:write` token. They are on
`sheetbase.lab.act` over MCP (Ask by default), as assistant cards, and in the
Python and TypeScript SDKs. They are not pipeline actions: a pipeline must not
change where pipelines may send data.

### `create_pipeline_connection`

Approves an address under a short key such as `lims`. Inputs: `p_key`,
`p_name`, `p_base_url`, optional `p_description`, `p_auth_header` (default
`Authorization`), `p_auth_scheme` (default `Bearer`), `p_kind` (`web`, the
default, an https address; or `hpc`, a Slurm cluster whose address may be http)
and `p_settings` (hpc only: `scheduler`, `user`, `queues`, optional
`callbackUrl`). A cluster signs with the secret `HPC_SUBMIT_KEY`, set in the
app. Returns the connection.
Sends `pipeline_connection.created`.

### `update_pipeline_connection`

Renames a connection, moves it to another address, or switches it off
(`p_status` `off`) or on (`active`). A switched-off connection stops every web
call that uses it. Returns the connection. Sends `pipeline_connection.updated`.

### `delete_pipeline_connection`

Removes a connection and its sealed secrets. Refused while a published pipeline
version still uses it in a web call or remote job step. Sends `pipeline_connection.deleted`.

## Runs

A run's signed manifest lists **Web responses recorded**: for each call the step,
the address (no query string), the request digest, the status and a digest of
the answer. Never the answer itself and never a secret.

## Events

| Event                         | When                                      |
| ----------------------------- | ----------------------------------------- |
| `pipeline_connection.created` | An address was approved                   |
| `pipeline_connection.updated` | Renamed, moved, or switched on or off     |
| `pipeline_connection.deleted` | A connection and its secrets were removed |
