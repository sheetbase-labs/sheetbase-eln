"""Command line: ``sheetbase push-step analysis.py --workspace ... --pipeline ...``.

Puts a local ``.py`` script or ``.ipynb`` notebook into a pipeline step as a draft.
It needs a personal token with ``pipelines:read`` and ``pipelines:write`` in
``SHEETBASE_CREDENTIAL`` and the instance in ``SHEETBASE_URL``. Nothing is
published: a person reviews and publishes the draft in the app.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional, Sequence

from sheetbase._pipeline_source import notebook_to_python, parse_requirements
from sheetbase.client import SheetbaseClient


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sheetbase")
    commands = parser.add_subparsers(dest="command", required=True)
    push = commands.add_parser(
        "push-step", help="save a local .py or .ipynb file as a pipeline step draft"
    )
    push.add_argument("file", type=Path)
    push.add_argument("--workspace", required=True, help="workspace UUID")
    push.add_argument("--pipeline", required=True, help="pipeline UUID")
    push.add_argument("--step", help="step name; omit to replace the main transform")
    push.add_argument("--requirements", type=Path, help="requirements.txt of name==version pins")
    push.add_argument("--runtime", help="Python runtime pin, for a pipeline that has none yet")
    parse = commands.add_parser(
        "parser", help="write, try and run a parser that Sheetbase calls over the web"
    )
    steps = parse.add_subparsers(dest="parser_command", required=True)
    serve = steps.add_parser("serve", help="run a parser file as a web service")
    serve.add_argument("file", type=Path, help="a Python file with a parse(file) function")
    serve.add_argument("--secret", help="signing key (or set SHEETBASE_PARSER_SECRET)")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)
    test = steps.add_parser("test", help="run a parser file on a sample file, without Sheetbase")
    test.add_argument("file", type=Path, help="a Python file with a parse(file) function")
    test.add_argument("sample", type=Path, help="a file the instrument produced")
    return parser


def _load_parse_function(path: Path):
    import importlib.util

    spec = importlib.util.spec_from_file_location("sheetbase_parser", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"{path} is not a Python file")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, "parse", None)
    if not callable(handler):
        raise LookupError(f"{path} needs a function called parse(file)")
    return handler


def _run_parser_command(args: argparse.Namespace) -> int:
    from sheetbase.parsers import ParseError, ParserApp, ParserRequest, _as_parsed_file, serve

    try:
        handler = _load_parse_function(args.file)
    except (OSError, ValueError, LookupError) as error:
        print(f"Could not load {args.file}: {error}", file=sys.stderr)
        return 1
    if args.parser_command == "serve":
        secret = args.secret or os.environ.get("SHEETBASE_PARSER_SECRET")
        if not secret:
            print("Give the signing key with --secret or SHEETBASE_PARSER_SECRET.", file=sys.stderr)
            return 2
        serve(handler, secret, host=args.host, port=args.port)
        return 0
    body = args.sample.read_bytes()
    try:
        parsed = _as_parsed_file(handler(ParserRequest(file_name=args.sample.name, body=body)))
    except ParseError as error:
        print(f"The parser refused the file: {error.message}", file=sys.stderr)
        return 1
    document = parsed.to_json()
    print(f"{len(document['rows'])} rows, columns: {', '.join(document['headers'])}")
    for row in document["rows"][:5]:
        print("  ", row)
    for warning in document["warnings"]:
        print(f"warning: {warning}")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "parser":
        return _run_parser_command(args)
    base_url = os.environ.get("SHEETBASE_URL")
    credential = os.environ.get("SHEETBASE_CREDENTIAL")
    if not base_url or not credential:
        print("Set SHEETBASE_URL and SHEETBASE_CREDENTIAL.", file=sys.stderr)
        return 2
    try:
        text = args.file.read_text(encoding="utf-8")
        code = notebook_to_python(text) if args.file.suffix == ".ipynb" else text
        requirements = (
            parse_requirements(args.requirements.read_text(encoding="utf-8"))
            if args.requirements
            else None
        )
        with SheetbaseClient(
            base_url, credential, ["pipelines:read", "pipelines:write"]
        ) as client:
            version, created = client.pipelines.sync_step(
                workspace_id=args.workspace,
                definition_id=args.pipeline,
                code=code,
                step=args.step,
                requirements=requirements,
                python_runtime=args.runtime,
            )
    except (OSError, ValueError, LookupError) as error:
        print(f"Could not push {args.file}: {error}", file=sys.stderr)
        return 1
    row = version[0] if isinstance(version, list) and version else version
    number = row.get("version") if isinstance(row, dict) else None
    print(f"{'Created' if created else 'Updated'} draft version {number} of the pipeline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
