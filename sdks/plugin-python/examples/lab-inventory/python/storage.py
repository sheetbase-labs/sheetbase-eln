def cold_chain(input):
    sample = input["sample"]
    place = input["to"]
    properties = sample.get("properties") or {}
    needs = str(properties.get("holdCondition") or "")
    warmest = (place.get("temperatureC") or {}).get("max")
    if "-80" in needs.replace("−", "-").replace(" ", "") and warmest is not None and warmest > -60:
        where = " / ".join(place.get("path") or [])
        return {
            "status": "refuse",
            "message": f"{sample['identifier']} needs {needs} and {where} runs at {warmest:g} °C.",
        }
    capacity, held = place.get("capacity"), place.get("held")
    if capacity and held is not None and held / capacity >= 0.9:
        return {
            "status": "warn",
            "message": f"{place.get('box')} is nearly full ({held} of {capacity} places taken).",
        }
    return {"status": "ok"}
