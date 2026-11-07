# Publishing and ontology API

Publish an experiment or a dataset version to Zenodo, Figshare, an InvenioRDM
instance or a Dataverse, with a DOI, packaged as an RO-Crate. A dataset version
made by a pipeline run also carries a Workflow Run Crate describing the run.
For what it means and how to set it up, see
[`../operations/publishing.md`](../operations/publishing.md).

Nothing is sent anywhere until an admin adds a repository and a person asks to
publish. Publishing is two steps: a **draft** is prepared at the repository
(which reserves the DOI), then a person makes it public. The second step cannot
be undone, so it is not on the API.

## Reading

| Resource                       | Scope          | Holds                                                    |
| ------------------------------ | -------------- | -------------------------------------------------------- |
| `GET /api/db/publication_targets`  | `admin:read`   | Repositories; `token_set` says if a token is stored (the token is never returned) |
| `GET /api/db/publications`         | `reviews:read` | Each publication: `status`, `doi`, `record_url`, `draft_url`, `package_name`, `includes_run_crate`, `last_error` |
| `GET /api/db/ontology_annotations` | `schema:read`  | Standard terms attached to fields                        |

`status` runs `queued`, `sending`, `draft`, `publishing`, `published`; or
`failed` (gave up after five tries; ask again) or `discarded`.

## Calls

| Call                                          | Scope           | What it does                                           |
| --------------------------------------------- | --------------- | ------------------------------------------------------ |
| `POST /api/db/rpc/save_publication_target`    | `admin:write`   | Add or change a repository (the token is set in the app) |
| `POST /api/db/rpc/delete_publication_target`  | `admin:write`   | Remove one; published records keep their DOI           |
| `POST /api/db/rpc/request_publication`        | `projects:write`| Prepare a draft of an `experiment` or `dataset_version` |
| `POST /api/db/rpc/discard_publication`        | `projects:write`| Throw a draft away                                     |
| `POST /api/db/rpc/retry_publication`          | `projects:write`| Try a failed one again                                 |
| `POST /api/db/rpc/ontology_settings`          | `admin:read`    | Whether ontology search is on                          |
| `POST /api/db/rpc/set_ontology_settings`      | `admin:write`   | Allow or stop searching the EBI Ontology Lookup Service |
| `POST /api/db/rpc/link_ontology_term`         | `schema:write`  | Attach a term to a field or vocabulary term            |
| `POST /api/db/rpc/unlink_ontology_term`       | `schema:write`  | Remove one                                             |

`GET /api/ontology/search?q=...` (browser session) searches the allowed
ontologies; it answers 409 while lookup is off.

## Events

`publication.created`, `publication.drafted`, `publication.published`,
`publication.failed`, `publication_target.updated`, `ontology.term.linked`,
`ontology.term.unlinked` and `ontology.settings.updated`; see
[`event-catalogue.md`](event-catalogue.md).
