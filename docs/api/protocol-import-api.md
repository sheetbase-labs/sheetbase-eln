# Protocol import API

Bring a protocol written elsewhere in as a draft protocol. The reading side
lives in plugins (the bundled protocols.io plugin searches and reads public
protocols); this is the lab action every source ends in.

## Actions

### `import_protocol`

Creates a draft protocol with its steps, reagents and a line saying where it
came from. The new protocol is an ordinary protocol: edit it, send it for
review, give it versions. Also a pipeline action.

Scope: `projects:write` (the same as creating a record).

| Argument        | Type   |                                                                                                                                      |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `p_title` *     | text   | The protocol title, up to 200 characters.                                                                                            |
| `p_steps` *     | json   | `[{ "text": "…", "section": "Prepare" }]`, 1 to 300 steps. `section` starts a heading where it changes.                              |
| `p_description` | text   | What it is for. Blank lines start new paragraphs.                                                                                    |
| `p_reagents`    | text[] | One line each.                                                                                                                       |
| `p_source`      | json   | `{ "provider": "protocols.io", "url": "https://…", "doi": "…" }`. Written as the first line of the protocol and sent with the event. |

Returns `{ record, steps }`.

## Events

`protocol.imported` (family `record`) carries `recordId`, `identifier`, `title`,
`provider`, `url` and `steps`; it can start a pipeline. The new protocol also
sends `record.created`.

## From the assistant and MCP

Ask the assistant to find a method ("find public PicoGreen protocols") and it
uses the protocols.io plugin's `search` and `read`, then offers `import` as a
confirm card. The same three operations are MCP tools
(`plugin.protocols-io.search`, `.read`, `.import`) and API routes under
`/api/plugins/protocols-io/`; see [Plugins API](plugins-api.md).
