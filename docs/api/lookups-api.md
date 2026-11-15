# Lab lookups API

Three reads for finding what the lab already has before starting work: the
protocols and SOPs a request would follow, the reagents and materials it would
use with what is on hand, and the templates and record models it could start
from. They are on every surface that reads: the assistant, MCP and the Python
SDK (see [lab-api.md](lab-api.md) for scopes and how tokens work).

None of them adds a table, RPC or event. Each puts together reads of tables that
are already on the API (`records`, `blocks`, `record_links`, `protocol_versions`,
`reagent_movements`, `notebook_templates`, `notebook_template_versions` and
`record_models`), so the same data can still be read table by table with
`sheetbase.canonical.read` or `GET /api/db/<table>`. They run as the person the
token belongs to, so row-level security still decides what is found.

| What                       | MCP and assistant         | Python SDK                        | Needs                                           |
| -------------------------- | ------------------------- | --------------------------------- | ----------------------------------------------- |
| Protocols and SOPs         | `sheetbase.protocol.read` | `client.lookups.protocols(query)` | `projects:read`                                 |
| Reagent and material stock | `sheetbase.stock.read`    | `client.lookups.stock(query)`     | `projects:read`                                 |
| Templates and models       | `sheetbase.template.list` | `client.lookups.templates(query)` | `projects:read`; `templates:read` for templates |

## Protocols and SOPs

`sheetbase.protocol.read` takes `query` (words in the name or number) or
`recordId`, and an optional `limit` (up to 10). Each match comes back with its
status, its newest versions (status, effective date, review due), its steps in
order, its prose, and the records it links to (the materials and reagents it
names). When nothing matches, the answer says so, so an agent does not invent a
protocol.

## Stock

`sheetbase.stock.read` takes `query` and an optional `limit`. For each matching
reagent or material it lists the lots with the quantity left, unit, expiry,
supplier and catalogue number, taken from each lot's latest stock movement.
Records with no stock movements are left out.

## Templates and models

`sheetbase.template.list` takes an optional `query` and `limit`. It lists the
record models (kinds of record) and, with `templates:read`, the notebook
templates with the newest published version of each, so a request can name the
template and model it starts from.

## The assistant

The assistant is told to look these up before it proposes a plan or any change
that sets up work: read the SOP that applies, check the reagents and what is on
hand and name the lot, and pick the template and model. If a lookup finds
nothing it says so and asks.
