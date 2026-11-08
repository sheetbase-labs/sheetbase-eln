from sheetbase_plugin import PluginError  # noqa: F401  (hooks refuse by answering, not by raising)


def check_experiment(input):
    """A hook that runs before a save is shown the record as it will be.

    It answers with `refuse` (stop the save, with these words), `warn` (let it
    through, with these words) and `set` (fields to fill in). Nothing else.
    """
    record = input["record"]
    title = (record.get("title") or "").strip()
    if len(title) < 5:
        return {"refuse": "Give the experiment a title of at least five characters."}
    answer = {}
    fields = record.get("custom_fields") or {}
    if not fields.get("protocol_note"):
        answer["warn"] = "No protocol note yet. Add one before this goes to review."
    if "storage" not in (record.get("tags") or []):
        answer["set"] = {"tags": list(record.get("tags") or []) + ["storage"]}
    return answer


def summarise(input):
    """A hook that runs after a save can write a summary, add search entries and more."""
    record = input["record"]
    summary = f"{record['identifier'] or 'New'}: {record['title']} ({record['status'].replace('_', ' ')})"
    return {
        "summary": summary,
        "index": [{"index": "summaries", "entry": "main", "text": f"{record['title']} {' '.join(record['tags'])}"}],
    }


def ask_for_review(input):
    """Ask for a sign-off. It is pressed by a person: a plugin never signs."""
    return {
        "sign_off": [
            {
                "key": "second-reviewer",
                "title": "A second reviewer has looked at this",
                "message": "Someone other than the person who sent it to review.",
                "roles": ["reviewer", "admin", "owner"],
                "approvals": 1,
                "independent": True,
            }
        ]
    }


def check_upload(input):
    # The file's words arrive as `content` because the hook asked for "file": "text".
    file = input["file"] or {}
    if not file.get("byte_size") or not (file.get("content") or "").strip():
        return {"refuse": "That file is empty."}
    return {}


def search(input):
    """A search provider can hand the app a question for the plugin's own index."""
    return {"hits": [], "nearest": {"index": "summaries", "text": input["query"]}}
