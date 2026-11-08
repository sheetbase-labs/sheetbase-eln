from sheetbase_plugin import ui


def screen(payload):
    context = payload["context"]
    return ui.screen(
        ui.stack(
            ui.heading("About this record", level=3),
            ui.row(ui.badge(context.get("kind") or "record", tone="info")),
            ui.text("Dilutions you work out in a notebook stay with that notebook block."),
        )
    )
