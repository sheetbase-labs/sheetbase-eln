# AI preferences API

Short standing notes the assistant keeps about how a lab, or one person, likes
things done: "96-well plates: blanks in column 12", "name experiments
PROJECT-YYMMDD-initials", "use the 10 mM stock for standards". A person
confirms each one on a card before it is saved, and the assistant reads the saved
ones before it plans, drafts or proposes (see [lab-api.md](lab-api.md) for
scopes and how tokens work).

## Two scopes

- **Personal** (`user`): yours alone. Nobody else can read it, not even an admin.
  Works from the app, a personal token, MCP and a pipeline run by you. A
  service credential has no person, so it is refused.
- **Lab** (`workspace`): followed in everyone's assistant. It steers what the
  assistant proposes for the whole lab, so it is an admin's choice like the other
  agent settings: it needs AI settings (manage) **and a person in the app**. A
  token, MCP or a pipeline is refused with `403`; they can still read it and save
  personal ones.

Each note is one sentence of up to 300 characters, with an optional topic of up
to 60. At most 25 per scope, and the same text is not saved twice. The notes
are habits, never permissions: they cannot let the assistant skip a
confirmation, sign or approve.

## Table

Read with `lab:read`.

### `ai_preferences`

What is saved: the lab's, and the caller's own.

| Column               | Type | Notes                                  |
| -------------------- | ---- | -------------------------------------- |
| `id`                 | uuid |                                        |
| `workspace_id`       | uuid |                                        |
| `scope`              | text | `workspace` or `user`                  |
| `user_id`            | text | Whose it is; null for a lab preference |
| `topic`              | text | Optional label                         |
| `body`               | text | The preference                         |
| `created_by_user_id` | text |                                        |
| `created_at`         | ts   |                                        |
| `updated_at`         | ts   |                                        |

## Actions

Need `lab:write`. Each is also a pipeline action and a confirm card in the
assistant.

### `save_ai_preference`

`p_body` * (text), `p_scope` (`user` by default, or `workspace`), `p_topic`
(text, may be null). Returns the preference. Sends `ai.preference.saved`.

### `update_ai_preference`

`p_preference_id` * (uuid), `p_body` * (text), `p_topic` (text, may be null).
Returns the preference. Sends `ai.preference.updated`.

### `delete_ai_preference`

`p_preference_id` * (uuid). Returns the preference that was removed. Sends
`ai.preference.deleted`. Agents may do it behind a confirmation.

## From the assistant and MCP

In the chat, say how you like something done ("we always put blanks in column
12") and the assistant offers a **Remember this** card; **Change** and **Forget**
cards work the same way. Saved preferences are in the assistant's instructions
for every chat, and it says which one it used in a plan. The assistant reads them
with `sheetbase.ai_preferences.list`. Over MCP, read the table with
`sheetbase.canonical.read` and act with `sheetbase.lab.act`.

People view, edit and remove them under **Settings, Account, AI preferences**.

## Events

`ai.preference.saved`, `ai.preference.updated` and `ai.preference.deleted`
(family `administration`); each can start a pipeline. See
[event-catalogue.md](event-catalogue.md).
