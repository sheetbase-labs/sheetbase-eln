"""The webhook parser protocol: signing, answers and the command line."""
import json
from io import BytesIO
from urllib.parse import quote

import pytest

from sheetbase import ParsedFile, ParseError, ParserApp, ParserRequest
from sheetbase.cli import main
from sheetbase.parsers import SignatureError, sign, verify_signature

SECRET = "test-key"
NOW = 1_800_000_000


def parse(file: ParserRequest) -> ParsedFile:
    lines = [line for line in file.text.splitlines() if line]
    if not lines or "sample" not in lines[0].lower():
        raise ParseError("This doesn't look like a PL-8 log.")
    header = lines[0].split(",")
    return ParsedFile(
        headers=header,
        rows=[dict(zip(header, line.split(","))) for line in lines[1:]],
        metadata={"instrument": "PL-8", "file": file.file_name},
    )


def request(body: bytes, *, secret: str = SECRET, at: int = NOW, name: str = "run 1.csv"):
    return {
        "Content-Type": "text/csv",
        "X-Sheetbase-File-Name": quote(name),
        "X-Sheetbase-Parser": "pl-8@1",
        "X-Sheetbase-Timestamp": str(at),
        "X-Sheetbase-Signature": sign(secret, at, body),
    }


def test_signature_covers_timestamp_and_body():
    body = b"Sample,Value\nA1,3\n"
    signature = sign(SECRET, NOW, body)
    verify_signature(SECRET, str(NOW), body, signature, now=NOW)
    with pytest.raises(SignatureError):
        verify_signature(SECRET, str(NOW), body + b"x", signature, now=NOW)
    with pytest.raises(SignatureError):
        verify_signature(SECRET, str(NOW + 1), body, signature, now=NOW)
    with pytest.raises(SignatureError):
        verify_signature("other", str(NOW), body, signature, now=NOW)
    with pytest.raises(SignatureError):
        verify_signature(SECRET, str(NOW), body, signature, now=NOW + 3600)


def test_reference_signature_value():
    # Pinned so the TypeScript side (webhook-parser.server.test.ts) signs the same bytes.
    assert sign("k", 1700000000, b"hello") == (
        "sha256=0c511384dbc4c6b6cbe53e5da961410697e51518b6128a9f4b1c0920a2ba5ff5"
    )


def test_answers_rows_for_a_signed_file():
    body = b"Sample,Value\nA1,3\nA2,\n"
    status, payload = ParserApp(parse, SECRET).handle(request(body), body, now=NOW)
    assert status == 200
    assert payload["headers"] == ["Sample", "Value"]
    assert payload["rows"] == [{"Sample": "A1", "Value": "3"}, {"Sample": "A2", "Value": ""}]
    assert payload["metadata"] == {"instrument": "PL-8", "file": "run 1.csv"}


def test_refuses_an_unsigned_or_wrongly_signed_request():
    body = b"Sample,Value\nA1,3\n"
    app = ParserApp(parse, SECRET)
    assert app.handle(request(body, secret="other"), body, now=NOW)[0] == 401
    headers = request(body)
    del headers["X-Sheetbase-Signature"]
    assert app.handle(headers, body, now=NOW)[0] == 401


def test_a_refusal_carries_words_for_the_scientist():
    body = b"nothing useful\n"
    status, payload = ParserApp(parse, SECRET).handle(request(body), body, now=NOW)
    assert status == 422
    assert payload["error"]["message"] == "This doesn't look like a PL-8 log."


def test_a_parser_bug_does_not_leak_a_traceback():
    def broken(file):
        raise RuntimeError("secret path /home/lab/x")

    body = b"x"
    status, payload = ParserApp(broken, SECRET).handle(request(body), body, now=NOW)
    assert status == 500
    assert "secret path" not in json.dumps(payload)


def test_rows_alone_and_dataframes_are_accepted():
    body = b"x"
    status, payload = ParserApp(lambda f: [{"a": 1}, {"a": 2, "b": 3}], SECRET).handle(
        request(body), body, now=NOW
    )
    assert status == 200 and payload["headers"] == ["a", "b"]


def test_wsgi_entry_point():
    body = b"Sample,Value\nA1,3\n"
    headers = request(body)
    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_LENGTH": str(len(body)),
        "CONTENT_TYPE": "text/csv",
        "wsgi.input": BytesIO(body),
        **{f"HTTP_{k.upper().replace('-', '_')}": v for k, v in headers.items() if k != "Content-Type"},
    }
    captured = {}
    # The clock is real here, so sign "now".
    import time

    environ["HTTP_X_SHEETBASE_TIMESTAMP"] = str(int(time.time()))
    environ["HTTP_X_SHEETBASE_SIGNATURE"] = sign(SECRET, environ["HTTP_X_SHEETBASE_TIMESTAMP"], body)
    out = ParserApp(parse, SECRET)(environ, lambda status, hdrs: captured.update(status=status))
    assert captured["status"].startswith("200")
    assert json.loads(out[0])["rows"][0]["Sample"] == "A1"


def test_cli_test_command(tmp_path, capsys):
    script = tmp_path / "my_parser.py"
    script.write_text(
        "from sheetbase.parsers import ParsedFile\n"
        "def parse(file):\n"
        "    return ParsedFile(rows=[{'n': line} for line in file.text.split()])\n"
    )
    sample = tmp_path / "run.txt"
    sample.write_text("a b")
    assert main(["parser", "test", str(script), str(sample)]) == 0
    assert "2 rows" in capsys.readouterr().out
