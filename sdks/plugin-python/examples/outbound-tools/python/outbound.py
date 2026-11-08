from sheetbase_plugin import PluginError


def plan_lims(input):
    """A publisher first says which requests to make. Sheetbase makes them."""
    rows = input["rows"]
    if not rows:
        raise PluginError("There are no rows to send.")
    project = str(input["parameters"]["project"]).strip()
    return {
        "requests": [
            {
                "method": "POST",
                "url": f"https://lims.example.org/api/projects/{project}/batches",
                "headers": {"Authorization": f"Bearer {input['settings']['token']}"},
                "json": {"name": input["name"] or "Sheetbase export", "results": rows},
            }
        ]
    }


def read_lims(input):
    """Then it reads the answer and says what happened, in words a scientist reads."""
    answer = input["responses"][0]
    if answer["status"] == 401:
        raise PluginError("The lab information system did not accept the API token.")
    if answer["status"] >= 300:
        raise PluginError(f"The lab information system answered {answer['status']}.")
    batch = (answer["json"] or {}).get("batch", {})
    return {
        "message": f"Sent {batch.get('count', '?')} results as batch {batch.get('id', '?')}.",
        "link": batch.get("url"),
    }


def plan_slack(input):
    """A channel turns one notification into the request that delivers it."""
    note = input["notification"]
    return {
        "requests": [
            {
                "method": "POST",
                "url": "https://slack.com/api/chat.postMessage",
                "headers": {"Authorization": f"Bearer {input['settings']['bot_token']}"},
                "json": {
                    "channel": input["destination"],
                    "text": f"*{note['title']}*\n{note['body']}\n<{note['link']}|Open in Sheetbase>",
                },
            }
        ]
    }


def check_slack(input):
    """Slack answers 200 even when it refuses, so the plugin reads the answer."""
    answer = input["responses"][0]
    body = answer["json"] or {}
    if not body.get("ok"):
        raise PluginError(f"Slack said: {body.get('error', 'no reason given')}.")
