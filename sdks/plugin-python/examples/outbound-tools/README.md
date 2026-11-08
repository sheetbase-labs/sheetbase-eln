# Outbound tools

Two ways to send things out of Sheetbase, in one plugin:

- **Publisher** `send-to-lims`: a dataset's menu gets "Send to Lab information system…".
  The plugin builds the request from the rows, Sheetbase makes it (only to
  `lims.example.org`, only over HTTPS) and the plugin reads the answer. An
  administrator sets the API token once in Settings, Plugins, Connections. Also
  usable from a pipeline (Plugin steps), the assistant, MCP and the API.
- **Notification channel** `slack`: each person turns it on in Settings,
  Notifications and says where their messages go (their Slack member ID).
  The plugin builds the Slack request for each notification.
