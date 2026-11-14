"""Command line: ``sheetbase push PL-0021 pipeline.yaml`` and ``sheetbase push-step analysis.py ...``.

``push`` saves a version file (YAML) as a draft of an Advanced pipeline; ``pull``
writes one out. Mistakes print as ``file:line:column: message`` and nothing is saved.

Puts a local ``.py`` script or ``.ipynb`` notebook into a pipeline step as a draft.
It needs a personal token with ``pipelines:read`` and ``pipelines:write`` in
``SHEETBASE_CREDENTIAL`` and the instance in ``SHEETBASE_URL``. Nothing is
published: a person reviews and publishes the draft in the app.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence

import httpx

from sheetbase._pipeline_source import notebook_to_python, parse_requirements
from sheetbase.client import SheetbaseClient
from sheetbase.errors import SheetbaseError


def _git_head(file: Path) -> Optional[str]:
    """The commit the file's repository is at, or None outside one (or without git)."""
    try:
        done = subprocess.run(
            ["git", "-C", str(file.resolve().parent), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    commit = done.stdout.strip()
    return commit if done.returncode == 0 and commit else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sheetbase")
    commands = parser.add_subparsers(dest="command", required=True)
    version_push = commands.add_parser(
        "push", help="save a version file (YAML) as a draft of an Advanced pipeline"
    )
    version_push.add_argument("pipeline", help="pipeline display id (PL-0021), key or UUID")
    version_push.add_argument("file", type=Path)
    version_push.add_argument(
        "--commit",
        help="the commit the file came from, recorded as the last push; default: HEAD of the file's git repository",
    )
    version_pull = commands.add_parser(
        "pull", help="write a pipeline's draft or latest version out as a version file"
    )
    version_pull.add_argument("pipeline", help="pipeline display id (PL-0021), key or UUID")
    version_pull.add_argument("file", type=Path, nargs="?", help="where to write it; omit to print")
    version_pull.add_argument("--version", type=int, help="a version number; omit for the draft")
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


def _run_version_file_command(args: argparse.Namespace, base_url: str, credential: str) -> int:
    from sheetbase.resources.pipelines import VersionFileError

    try:
        scopes = ["pipelines:read", "pipelines:write"] if args.command == "push" else ["pipelines:read"]
        with SheetbaseClient(base_url, credential, scopes) as client:
            if args.command == "pull":
                text = client.pipelines.pull_version_file(args.pipeline, version=args.version)
                if args.file:
                    args.file.write_text(text, encoding="utf-8")
                    print(f"Wrote {args.file}.")
                else:
                    sys.stdout.write(text)
                return 0
            version, created = client.pipelines.push_version_file(
                args.pipeline,
                args.file.read_text(encoding="utf-8"),
                commit=args.commit or _git_head(args.file),
            )
    except VersionFileError as error:
        for problem in error.problems:
            print(f"{args.file}:{problem['line']}:{problem['column']}: {problem['message']}", file=sys.stderr)
        return 1
    except (OSError, ValueError, LookupError) as error:
        print(f"Could not {args.command} {args.pipeline}: {error}", file=sys.stderr)
        return 1
    row = version[0] if isinstance(version, list) and version else version
    number = row.get("version") if isinstance(row, dict) else None
    print(f"{'Created' if created else 'Updated'} draft version {number} of the pipeline.")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Run a command; a refusal from the server or a connection problem prints one line, not a traceback."""
    args = build_parser().parse_args(argv)
    try:
        return _dispatch(args)
    except SheetbaseError as error:
        print(f"Sheetbase refused the request: {_plain_refusal(error)}", file=sys.stderr)
        return 1
    except httpx.HTTPError as error:
        print(
            f"Could not reach {os.environ.get('SHEETBASE_URL', 'the Sheetbase instance')}: {error}",
            file=sys.stderr,
        )
        return 1


def _plain_refusal(error: SheetbaseError) -> str:
    """The server's reason, with a list of configuration problems laid out as ``field: message``."""
    text = str(error)
    marker = text.find("[", text.find("]") + 1)  # the list after the leading ``[category]``
    if marker == -1:
        return text
    try:
        problems = json.loads(text[marker : text.rfind("]") + 1])
    except ValueError:
        return text
    if not isinstance(problems, list) or not all(isinstance(p, dict) and "message" in p for p in problems):
        return text
    lines = [f"  {p.get('field') or 'configuration'}: {p['message']}" for p in problems]
    return f"{text[:marker].rstrip(': ')}\n" + "\n".join(lines)


def _dispatch(args: argparse.Namespace) -> int:
    if args.command == "parser":
        return _run_parser_command(args)
    base_url = os.environ.get("SHEETBASE_URL")
    credential = os.environ.get("SHEETBASE_CREDENTIAL")
    if not base_url or not credential:
        print("Set SHEETBASE_URL and SHEETBASE_CREDENTIAL.", file=sys.stderr)
        return 2
    if args.command in ("push", "pull"):
        return _run_version_file_command(args, base_url, credential)
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
