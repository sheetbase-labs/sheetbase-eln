"""Write a Sheetbase parser as a small web service.

A *webhook parser* is a parser that runs on your own server. Sheetbase sends
it the file an instrument produced, signed with a key only the two of you
know, and it answers with the file's rows. This module takes care of the
protocol, so a parser is one function::

    from sheetbase.parsers import ParsedFile, ParseError, ParserRequest, serve

    def parse(file: ParserRequest) -> ParsedFile:
        lines = file.text.splitlines()
        if not lines or "Sample" not in lines[0]:
            raise ParseError("This doesn't look like a PL-8 log.")
        header, *rows = [line.split(",") for line in lines]
        return ParsedFile(
            headers=header,
            rows=[dict(zip(header, row)) for row in rows],
            metadata={"instrument": "PL-8"},
        )

    serve(parse, secret="the key Sheetbase showed you")

This module uses only the standard library. Run it behind any web server, or use ``serve``/``ParserApp`` (a WSGI app) directly,
or call ``ParserApp.handle`` from Flask, FastAPI or anything else.

The protocol, for reference:

* Request: ``POST`` with the raw file as the body and the headers
  ``X-Sheetbase-File-Name`` (URL-encoded), ``X-Sheetbase-Parser``
  (``key@version``), ``X-Sheetbase-Timestamp`` (seconds since the epoch) and
  ``X-Sheetbase-Signature`` (``sha256=`` followed by the hex HMAC-SHA256, with
  your key, of ``"<timestamp>."`` and the body).
* Answer: ``200`` with ``{"headers": [...], "rows": [{...}], "metadata": {...},
  "warnings": [...]}``, or ``4xx`` with ``{"error": {"code": "...",
  "message": "..."}}``. The message is shown to the scientist, so write it
  for them.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Optional, Union
from urllib.parse import unquote

__all__ = [
    "ParseError",
    "ParsedFile",
    "ParserApp",
    "ParserRequest",
    "SignatureError",
    "serve",
    "sign",
    "verify_signature",
]

#: How far a request's timestamp may be from the clock, in seconds.
DEFAULT_TOLERANCE_SECONDS = 300


class ParseError(Exception):
    """The file can't be read. ``message`` is shown to the person who sent it."""

    def __init__(self, message: str, code: str = "unreadable") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class SignatureError(Exception):
    """The request wasn't signed with your key, or is too old."""


@dataclass
class ParsedFile:
    """What a parser found in a file."""

    headers: list = field(default_factory=list)
    rows: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)

    def to_json(self) -> dict:
        headers = list(self.headers)
        if not headers:
            for row in self.rows:
                for key in row:
                    if key not in headers:
                        headers.append(key)
        return {
            "headers": headers,
            "rows": [dict(row) for row in self.rows],
            "metadata": dict(self.metadata),
            "warnings": list(self.warnings),
        }


@dataclass
class ParserRequest:
    """A file Sheetbase sent for parsing."""

    file_name: str
    body: bytes
    media_type: str = "application/octet-stream"
    parser: str = ""

    @property
    def text(self) -> str:
        """The file decoded as UTF-8 (a leading byte-order mark is dropped)."""
        return self.body.decode("utf-8-sig")


def sign(secret: str, timestamp: Union[int, str], body: bytes) -> str:
    """The ``X-Sheetbase-Signature`` value for a body. Mostly for tests."""
    mac = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    mac.update(f"{timestamp}.".encode("utf-8"))
    mac.update(body)
    return f"sha256={mac.hexdigest()}"


def verify_signature(
    secret: str,
    timestamp: str,
    body: bytes,
    signature: str,
    *,
    now: Optional[float] = None,
    tolerance: int = DEFAULT_TOLERANCE_SECONDS,
) -> None:
    """Raises :class:`SignatureError` unless the request is signed with ``secret`` and recent."""
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        raise SignatureError("The request has no valid timestamp.") from None
    if abs((time.time() if now is None else now) - sent_at) > tolerance:
        raise SignatureError("The request is too old.")
    if not hmac.compare_digest(sign(secret, timestamp, body), signature or ""):
        raise SignatureError("The signature doesn't match.")


Result = Union[ParsedFile, Mapping[str, Any], Iterable[Mapping[str, Any]], Any]
Handler = Callable[[ParserRequest], Result]


def _as_parsed_file(result: Result) -> ParsedFile:
    if isinstance(result, ParsedFile):
        return result
    if isinstance(result, Mapping):
        return ParsedFile(
            headers=list(result.get("headers", [])),
            rows=list(result.get("rows", [])),
            metadata=dict(result.get("metadata", {})),
            warnings=list(result.get("warnings", [])),
        )
    # A pandas DataFrame, without importing pandas.
    to_dict = getattr(result, "to_dict", None)
    if callable(to_dict):
        rows = [
            {str(k): (None if v != v else v) for k, v in row.items()}
            for row in to_dict(orient="records")
        ]
        return ParsedFile(headers=[str(c) for c in result.columns], rows=rows)
    return ParsedFile(rows=[dict(row) for row in result])


class ParserApp:
    """Wraps a parse function in the Sheetbase protocol.

    ``secret`` is the signing key Sheetbase showed when the parser was set up.
    Pass ``secret=None`` only while trying it out locally: requests are then
    not checked.
    """

    def __init__(
        self,
        handler: Handler,
        secret: Optional[str],
        *,
        tolerance: int = DEFAULT_TOLERANCE_SECONDS,
    ) -> None:
        self.handler = handler
        self.secret = secret
        self.tolerance = tolerance

    def handle(
        self, headers: Mapping[str, str], body: bytes, *, now: Optional[float] = None
    ) -> "tuple[int, dict]":
        """Answers one request: ``(status, json_body)``. Use this from any web framework."""
        lower = {key.lower(): value for key, value in headers.items()}
        if self.secret is not None:
            try:
                verify_signature(
                    self.secret,
                    lower.get("x-sheetbase-timestamp", ""),
                    body,
                    lower.get("x-sheetbase-signature", ""),
                    now=now,
                    tolerance=self.tolerance,
                )
            except SignatureError as error:
                return 401, _error("unauthorised", str(error))
        request = ParserRequest(
            file_name=unquote(lower.get("x-sheetbase-file-name", "")),
            body=body,
            media_type=lower.get("content-type", "application/octet-stream"),
            parser=lower.get("x-sheetbase-parser", ""),
        )
        try:
            parsed = _as_parsed_file(self.handler(request)).to_json()
        except ParseError as error:
            return 422, _error(error.code, error.message)
        except UnicodeDecodeError:
            return 422, _error("not_text", "The file isn't text this parser can read.")
        except Exception:  # noqa: BLE001 - a parser bug must not leak a traceback
            return 500, _error("parser_failed", "The parser stopped with an error.")
        if not parsed["rows"]:
            return 422, _error("no_rows", "The file has no data rows.")
        return 200, parsed

    def __call__(self, environ: dict, start_response: Callable) -> "list[bytes]":
        """WSGI entry point: ``gunicorn my_parser:app``."""
        if environ.get("REQUEST_METHOD") != "POST":
            return _wsgi(start_response, 405, _error("method_not_allowed", "Use POST."))
        length = int(environ.get("CONTENT_LENGTH") or 0)
        body = environ["wsgi.input"].read(length) if length else b""
        headers = {
            key[5:].replace("_", "-").lower(): value
            for key, value in environ.items()
            if key.startswith("HTTP_")
        }
        headers["content-type"] = environ.get("CONTENT_TYPE", "")
        status, payload = self.handle(headers, body)
        return _wsgi(start_response, status, payload)


def _error(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


_REASONS = {200: "OK", 401: "Unauthorized", 405: "Method Not Allowed", 422: "Unprocessable Entity", 500: "Internal Server Error"}


def _wsgi(start_response: Callable, status: int, payload: dict) -> "list[bytes]":
    data = json.dumps(payload).encode("utf-8")
    start_response(
        f"{status} {_REASONS.get(status, 'Error')}",
        [("Content-Type", "application/json"), ("Content-Length", str(len(data)))],
    )
    return [data]


def serve(
    handler: Handler,
    secret: Optional[str],
    *,
    host: str = "0.0.0.0",
    port: int = 8000,
) -> None:
    """Runs a parser with the standard library's web server. Fine for a lab PC;
    put a real WSGI server (``gunicorn``, ``waitress``) in front of ``ParserApp``
    for anything busier."""
    from wsgiref.simple_server import WSGIRequestHandler, make_server

    class Quiet(WSGIRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            print(f"{self.address_string()} {format % args}")

    with make_server(host, port, ParserApp(handler, secret), handler_class=Quiet) as server:
        print(f"Parser listening on http://{host}:{port}")
        server.serve_forever()
