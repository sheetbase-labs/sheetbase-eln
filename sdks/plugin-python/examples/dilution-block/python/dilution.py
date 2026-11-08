from sheetbase_plugin import ui


def screen(payload):
    kept = payload.get("state") or {}
    event = payload.get("event")
    values = kept
    notice = None
    if event and event["action"] == "work":
        values = event["values"]
    stock = float(values.get("stock") or 10)
    target = float(values.get("target") or 1)
    volume = float(values.get("volume") or 50)
    children = [
        ui.form(
            ui.row(
                ui.number_input("stock", "Stock (mM)", value=stock, required=True),
                ui.number_input("target", "Target (mM)", value=target, required=True),
                ui.number_input("volume", "Final volume (µL)", value=volume, required=True),
            ),
            submit=ui.submit("Work it out", "work"),
        )
    ]
    if target > stock:
        notice = ui.notice("The target is stronger than the stock.", tone="warning")
    elif event:
        stock_ul = round(target * volume / stock, 2)
        children.append(
            ui.row(
                ui.stat("Stock to add", stock_ul, unit="µL", tone="success"),
                ui.stat("Diluent to add", round(volume - stock_ul, 2), unit="µL"),
            )
        )
        children.append(ui.bar(stock_ul, max=volume, label=f"{stock_ul} of {volume} µL is stock", tone="info"))
    return ui.screen(
        ui.stack(*children),
        state={"stock": stock, "target": target, "volume": volume},
        notice=notice,
    )
