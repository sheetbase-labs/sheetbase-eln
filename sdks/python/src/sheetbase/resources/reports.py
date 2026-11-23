"""Reports: download a generated report as Word, PDF or HTML.

Needs a personal token holding ``lab:read``. Every format is made from the
document stored when the report was generated, so the report's fingerprint (its
``output_checksum``) is the same in all three.
"""
from __future__ import annotations

from typing import Literal

from sheetbase._http import AsyncHttpTransport, HttpTransport

ReportFormat = Literal["docx", "pdf", "html"]


class ReportsResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def download(self, generation_id: str, *, format: ReportFormat = "docx") -> bytes:
        """The bytes of a generated report (``generate_report`` returns its id)."""
        return self._transport.request(
            "GET",
            f"/api/export/report-generation/{generation_id}",
            params={"format": format},
            raw=True,
        )


class AsyncReportsResource:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def download(self, generation_id: str, *, format: ReportFormat = "docx") -> bytes:
        return await self._t.request(
            "GET",
            f"/api/export/report-generation/{generation_id}",
            params={"format": format},
            raw=True,
        )
