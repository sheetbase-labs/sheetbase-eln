# Agent page conversations API

The Agent page keeps each person's conversations with the assistant. They are
reachable with a personal token, over MCP, in pipelines (as trigger events) and
through webhooks, the same way as the rest of the lab (see
[lab-api.md](lab-api.md) for scopes and how tokens work).

- Conversations are one person's own. Nobody else reads them, not an admin and
  not a service credential, which has no person. A token sees only the
  conversations of the person it belongs to, in the workspace it is used in.
- Read the `assistant_conversations` table with `GET /api/db/assistant_conversations` (`lab:read`), or over
  MCP with `sheetbase.canonical.read`. The columns are `id`, `title`,
  `messages` (the chat's message parts as JSON), `created_at` and `updated_at`.
- Save, rename and delete need `lab:write` and a **personal token**.
- The chat itself is the assistant: its answers, tools, confirm cards, budget
  and agent permissions are the same as in the side panel. See
  [agent-permissions-api.md](agent-permissions-api.md).
- Webhook events: `assistant.conversation.created` and
  `assistant.conversation.deleted`. The payload carries the conversation's id
  and title (and the message count), never the messages. Both can start a
  pipeline.

## Save a conversation with the assistant

`save_assistant_conversation` starts a conversation, or replaces the messages
of one of your own when you pass its id. The title is kept unless you pass one.
Needs a personal token. Returns the conversation. Sends
`assistant.conversation.created` for a new one.

| Argument            | Type | Notes                                       |
| ------------------- | ---- | ------------------------------------------- |
| `p_messages`        | json | The messages, as a JSON array (400 at most) |
| `p_conversation_id` | uuid | Your conversation to update; optional       |
| `p_title`           | text | The title, 200 characters; optional         |

## Rename a conversation with the assistant

`rename_assistant_conversation` gives one of your conversations a new title.
Needs a personal token. Returns the conversation.

| Argument            | Type | Notes                   |
| ------------------- | ---- | ----------------------- |
| `p_conversation_id` | uuid | Your conversation       |
| `p_title`           | text | The new title (200 max) |

## Delete a conversation with the assistant

`delete_assistant_conversation` deletes one of your conversations for good.
Needs a personal token. Sends `assistant.conversation.deleted`.

| Argument            | Type | Notes             |
| ------------------- | ---- | ----------------- |
| `p_conversation_id` | uuid | Your conversation |
