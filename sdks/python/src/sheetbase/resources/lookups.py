"""Lab lookups: the protocols and SOPs a piece of work follows, the reagents and
materials it uses with what is on hand, and the templates and record models it
could start from.

These are the same three reads the assistant and MCP have
(``sheetbase.protocol.read``, ``sheetbase.stock.read``,
``sheetbase.template.list``), put together from tables already on the API, so
the token needs the read scopes those tables need (``projects:read``, and
``templates:read`` for templates). They run as the person the token belongs to.
"""

from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import AsyncHttpTransport, HttpTransport


def _like(value: str) -> str:
    cleaned = "".join(" " if c in "*%,()\\" else c for c in value).strip()
    return f"*{cleaned}*"


def _matching(columns: list[str], value: str) -> str:
    return "or=(" + ",".join(f"{c}.ilike.{_like(value)}" for c in columns) + ")"


def _protocol_content(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    text: list[str] = []
    for block in blocks:
        payload = block.get("payload") or {}
        if block.get("type") == "procedure_step" and "text" in payload:
            steps.append({"number": payload.get("stepNumber"), "text": payload["text"]})
        elif isinstance(payload.get("doc"), dict):
            plain = " ".join(_flatten(payload["doc"]).split())
            if plain:
                text.append(plain)
    steps.sort(key=lambda s: s["number"] or 0)
    return {"steps": steps, "text": text}


def _flatten(node: dict[str, Any]) -> str:
    if "text" in node:
        return str(node["text"])
    return " ".join(_flatten(c) for c in node.get("content", []) if isinstance(c, dict))


def lots_on_hand(movements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The latest movement of each lot says how much of it is left."""
    latest: dict[str, dict[str, Any]] = {}
    for m in movements:
        key = m.get("lot") or ""
        if key not in latest or latest[key]["created_at"] < m["created_at"]:
            latest[key] = m
    return [
        {
            "lot": m.get("lot"),
            "quantity_left": m.get("resulting_quantity"),
            "unit": m.get("unit"),
            "expiry": m.get("expiry"),
            "supplier": m.get("supplier"),
            "catalogue_number": m.get("catalog_no"),
            "as_of": m.get("created_at"),
        }
        for m in latest.values()
    ]


def _latest_published(versions: list[dict[str, Any]], template_id: str) -> Optional[dict[str, Any]]:
    own = [v for v in versions if v["template_id"] == template_id]
    return next((v for v in own if v.get("lifecycle") == "published"), own[0] if own else None)


class LookupsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._t = transport

    def _rows(self, resource: str, query: str) -> list[dict[str, Any]]:
        return self._t.get(f"/api/db/{resource}?{query}")

    def protocols(
        self,
        query: Optional[str] = None,
        *,
        record_id: Optional[str] = None,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Protocols matching the words (or one by id), with steps, versions and links."""
        if query is None and record_id is None:
            raise ValueError("Send a query or a record_id.")
        flt = f"id=eq.{record_id}" if record_id else _matching(["title", "identifier"], query or "")
        records = self._rows(
            "records",
            f"select=id,kind,identifier,title,status&kind=ilike.protocol*&archived_at=is.null&{flt}&order=title.asc&limit={limit}",
        )
        out = []
        for r in records:
            rid = r["id"]
            blocks = self._rows("blocks", f"select=type,payload&record_id=eq.{rid}&order=order.asc&limit=200")
            versions = self._rows(
                "protocol_versions",
                f"select=version,status,effective_at,review_due_at&protocol_record_id=eq.{rid}&order=version.desc&limit=3",
            )
            links = self._rows(
                "record_links",
                f"select=target_kind,target_identifier,link_type&source_record_id=eq.{rid}&limit=100",
            )
            out.append({**r, "versions": versions, **_protocol_content(blocks), "linked_records": links})
        return out

    def stock(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        """Reagents and materials matching the words, with each lot's quantity left."""
        records = self._rows(
            "records",
            f"select=id,kind,identifier,title,status&archived_at=is.null&{_matching(['title', 'identifier'], query)}&order=title.asc&limit={limit * 3}",
        )
        if not records:
            return []
        ids = ",".join(r["id"] for r in records)
        moves = self._rows(
            "reagent_movements",
            f"select=reagent_record_id,lot,resulting_quantity,unit,expiry,supplier,catalog_no,created_at&reagent_record_id=in.({ids})&order=created_at.desc&limit=500",
        )
        items = [
            {**r, "lots": lots_on_hand([m for m in moves if m["reagent_record_id"] == r["id"]])}
            for r in records
        ]
        return [i for i in items if i["lots"]][:limit]

    def templates(self, query: Optional[str] = None, *, limit: int = 20) -> dict[str, Any]:
        """Notebook templates (newest published version) and record models, by name."""
        flt = f"&{_matching(['name'], query)}" if query else ""
        models = self._rows(
            "record_models",
            f"select=id,key,name,description,identifier_prefix,lifecycle,current_version{flt}&order=name.asc&limit={limit}",
        )
        templates = self._rows(
            "notebook_templates",
            f"select=id,key,name,description,lifecycle,display_id{flt}&order=name.asc&limit={limit}",
        )
        versions: list[dict[str, Any]] = []
        if templates:
            ids = ",".join(t["id"] for t in templates)
            versions = self._rows(
                "notebook_template_versions",
                f"select=template_id,version,lifecycle&template_id=in.({ids})&order=version.desc&limit=500",
            )
        return {
            "templates": [{**t, "latest_version": _latest_published(versions, t["id"])} for t in templates],
            "models": models,
        }


class AsyncLookupsResource:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def _rows(self, resource: str, query: str) -> list[dict[str, Any]]:
        return await self._t.get(f"/api/db/{resource}?{query}")

    async def protocols(
        self,
        query: Optional[str] = None,
        *,
        record_id: Optional[str] = None,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        if query is None and record_id is None:
            raise ValueError("Send a query or a record_id.")
        flt = f"id=eq.{record_id}" if record_id else _matching(["title", "identifier"], query or "")
        records = await self._rows(
            "records",
            f"select=id,kind,identifier,title,status&kind=ilike.protocol*&archived_at=is.null&{flt}&order=title.asc&limit={limit}",
        )
        out = []
        for r in records:
            rid = r["id"]
            blocks = await self._rows("blocks", f"select=type,payload&record_id=eq.{rid}&order=order.asc&limit=200")
            versions = await self._rows(
                "protocol_versions",
                f"select=version,status,effective_at,review_due_at&protocol_record_id=eq.{rid}&order=version.desc&limit=3",
            )
            links = await self._rows(
                "record_links",
                f"select=target_kind,target_identifier,link_type&source_record_id=eq.{rid}&limit=100",
            )
            out.append({**r, "versions": versions, **_protocol_content(blocks), "linked_records": links})
        return out

    async def stock(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        records = await self._rows(
            "records",
            f"select=id,kind,identifier,title,status&archived_at=is.null&{_matching(['title', 'identifier'], query)}&order=title.asc&limit={limit * 3}",
        )
        if not records:
            return []
        ids = ",".join(r["id"] for r in records)
        moves = await self._rows(
            "reagent_movements",
            f"select=reagent_record_id,lot,resulting_quantity,unit,expiry,supplier,catalog_no,created_at&reagent_record_id=in.({ids})&order=created_at.desc&limit=500",
        )
        items = [
            {**r, "lots": lots_on_hand([m for m in moves if m["reagent_record_id"] == r["id"]])}
            for r in records
        ]
        return [i for i in items if i["lots"]][:limit]

    async def templates(self, query: Optional[str] = None, *, limit: int = 20) -> dict[str, Any]:
        flt = f"&{_matching(['name'], query)}" if query else ""
        models = await self._rows(
            "record_models",
            f"select=id,key,name,description,identifier_prefix,lifecycle,current_version{flt}&order=name.asc&limit={limit}",
        )
        templates = await self._rows(
            "notebook_templates",
            f"select=id,key,name,description,lifecycle,display_id{flt}&order=name.asc&limit={limit}",
        )
        versions: list[dict[str, Any]] = []
        if templates:
            ids = ",".join(t["id"] for t in templates)
            versions = await self._rows(
                "notebook_template_versions",
                f"select=template_id,version,lifecycle&template_id=in.({ids})&order=version.desc&limit=500",
            )
        return {
            "templates": [{**t, "latest_version": _latest_published(versions, t["id"])} for t in templates],
            "models": models,
        }
