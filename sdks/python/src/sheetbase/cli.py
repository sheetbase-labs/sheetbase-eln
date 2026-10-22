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
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
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
