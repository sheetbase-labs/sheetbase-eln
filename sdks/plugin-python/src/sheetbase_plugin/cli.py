"""The ``sheetbase-plugin`` command: start, check, try, pack and watch a plugin."""
import argparse
import json
import os
import sys
import time

from . import __version__, host
from .package import (
    check_package,
    pack,
    read_folder,
    unpack,
)
from .values import ValueProblem, check_values

INIT_MANIFEST = {
    "id": "acme.hello",
    "name": "Hello",
    "version": "0.1.0",
    "description": "Says hello to someone. Replace this with what your plugin does.",
    "provides": {
        "operations": [
            {
                "id": "greet",
                "title": "Greet someone",
                "description": "Greets a person by name.",
                "access": "read",
                "inputs": [{"name": "name", "type": "text", "required": True}],
                "outputs": [{"name": "greeting", "type": "text", "required": True}],
                "run": "ops:greet",
            }
        ]
    },
    "examples": [{"operation": "greet", "input": {"name": "Ada"}, "output": {"greeting": "Hello, Ada!"}}],
}

INIT_OPS = '''from sheetbase_plugin import PluginError


def greet(input):
    name = input["name"].strip()
    if not name:
        raise PluginError("Give a name to greet.")
    return {"greeting": f"Hello, {name}!"}
'''


def _load(folder):
    files = read_folder(folder)
    return files, check_package(files)


def _manifest(files):
    return json.loads(files["plugin.json"])


def _declaration(manifest, point, ident):
    for entry in manifest.get("provides", {}).get(point, []):
        if entry["id"] == ident:
            return entry
    return None


def run_operation(files, operation_id, value):
    """Run one operation of a loaded package the way Sheetbase does, in this process."""
    manifest = _manifest(files)
    declaration = _declaration(manifest, "operations", operation_id)
    if declaration is None:
        raise KeyError(f"This plugin has no operation called {operation_id}.")
    given = check_values(declaration["inputs"], value, "input")
    host.install({k[len("python/"):]: v for k, v in files.items() if k.startswith("python/")})
    result = host.call_operation(declaration["run"], given)
    return check_values(declaration["outputs"], result, "answer")


def cmd_init(args):
    folder = args.folder
    if os.path.exists(folder) and os.listdir(folder):
        print(f"{folder} is not empty.", file=sys.stderr)
        return 1
    os.makedirs(os.path.join(folder, "python"), exist_ok=True)
    with open(os.path.join(folder, "plugin.json"), "w", encoding="utf-8") as handle:
        json.dump(INIT_MANIFEST, handle, indent=2)
        handle.write("\n")
    with open(os.path.join(folder, "python", "ops.py"), "w", encoding="utf-8") as handle:
        handle.write(INIT_OPS)
    print(f"Made {folder}. Next: sheetbase-plugin dev {folder}")
    return 0


def cmd_validate(args):
    files, errors = _load(args.folder)
    if errors:
        for problem in errors:
            print(f"  ✗ {problem}")
        return 1
    manifest = _manifest(files)
    provides = manifest["provides"]
    count = sum(len(provides.get(key, [])) for key in provides)
    print(f"✓ {manifest['name']} {manifest['version']}: {count} contribution(s), {len(files)} file(s)")
    return 0


def cmd_run(args):
    files, errors = _load(args.folder)
    if errors:
        for problem in errors:
            print(f"  ✗ {problem}")
        return 1
    try:
        value = json.loads(args.input)
    except ValueError as error:
        print(f"--input is not valid JSON: {error}", file=sys.stderr)
        return 2
    try:
        print(json.dumps(run_operation(files, args.operation, value), indent=2, sort_keys=True))
    except (ValueProblem, KeyError) as error:
        print(f"✗ {error.args[0] if isinstance(error, KeyError) else error}")
        return 1
    except Exception as error:  # the plugin's own refusal or crash
        from . import PluginError

        label = "refused" if isinstance(error, PluginError) else f"crashed ({type(error).__name__})"
        print(f"✗ The plugin {label}: {error}")
        return 1
    return 0


def run_examples(files):
    """Run every example in ``plugin.json``. Returns (passed, failed, lines)."""
    manifest = _manifest(files)
    passed = failed = 0
    lines = []
    for index, example in enumerate(manifest.get("examples", []), start=1):
        label = f"{example['operation']} #{index}"
        try:
            got = run_operation(files, example["operation"], example["input"])
        except Exception as error:
            failed += 1
            lines.append(f"  ✗ {label}: {error}")
            continue
        if "output" in example and got != example["output"]:
            failed += 1
            lines.append(f"  ✗ {label}: expected {json.dumps(example['output'], sort_keys=True)}, got {json.dumps(got, sort_keys=True)}")
        else:
            passed += 1
            lines.append(f"  ✓ {label} → {json.dumps(got, sort_keys=True)}")
    return passed, failed, lines


def cmd_test(args):
    files, errors = _load(args.folder)
    if errors:
        for problem in errors:
            print(f"  ✗ {problem}")
        return 1
    passed, failed, lines = run_examples(files)
    print("\n".join(lines) or "  (no examples in plugin.json)")
    print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


def cmd_pack(args):
    files, errors = _load(args.folder)
    if errors:
        for problem in errors:
            print(f"  ✗ {problem}")
        return 1
    manifest = _manifest(files)
    out = args.output or f"{manifest['id']}-{manifest['version']}.sbplugin"
    data = pack(files)
    with open(out, "wb") as handle:
        handle.write(data)
    print(f"✓ {out} ({len(data)} bytes). Upload it in Settings › Plugins.")
    return 0


def cmd_inspect(args):
    with open(args.package, "rb") as handle:
        files = unpack(handle.read())
    errors = check_package(files)
    for problem in errors:
        print(f"  ✗ {problem}")
    if not errors:
        manifest = _manifest(files)
        print(f"✓ {manifest['name']} {manifest['version']} ({manifest['id']})")
        for point, entries in manifest["provides"].items():
            for entry in entries:
                print(f"  - {point}: {entry['id']} — {entry['title']}")
    return 1 if errors else 0


def _stamp(folder):
    stamp = {}
    for root, dirs, names in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", ".venv", "node_modules")]
        for name in names:
            full = os.path.join(root, name)
            try:
                stamp[full] = os.stat(full).st_mtime_ns
            except OSError:
                pass
    return stamp


def cmd_dev(args):
    """Check the plugin and run its examples, again each time a file changes."""
    last = None
    while True:
        stamp = _stamp(args.folder)
        if stamp != last:
            last = stamp
            print(f"\n[{time.strftime('%H:%M:%S')}] checking {args.folder}")
            files, errors = _load(args.folder)
            if errors:
                for problem in errors:
                    print(f"  ✗ {problem}")
            else:
                _, failed, lines = run_examples(files)
                print("\n".join(lines) or "  (no examples in plugin.json)")
                if failed == 0:
                    print("  Ready. Pack it with: sheetbase-plugin pack " + args.folder)
            sys.stdout.flush()
            if args.once:
                return 0
        time.sleep(0.5)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="sheetbase-plugin", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="make a small plugin to start from")
    init.add_argument("folder")
    init.set_defaults(func=cmd_init)

    for name, func, help_text in (
        ("validate", cmd_validate, "check plugin.json and the files it points at"),
        ("test", cmd_test, "run the examples listed in plugin.json"),
        ("dev", cmd_dev, "check and run the examples again whenever a file changes"),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("folder", nargs="?", default=".")
        command.set_defaults(func=func)
        if name == "dev":
            command.add_argument("--once", action="store_true", help="check once and stop")

    run = sub.add_parser("run", help="run one operation on an input")
    run.add_argument("operation")
    run.add_argument("--input", default="{}", help="the input as JSON")
    run.add_argument("--folder", default=".")
    run.set_defaults(func=cmd_run)

    packer = sub.add_parser("pack", help="make the .sbplugin file to upload")
    packer.add_argument("folder", nargs="?", default=".")
    packer.add_argument("-o", "--output")
    packer.set_defaults(func=cmd_pack)

    inspect = sub.add_parser("inspect", help="check a .sbplugin file and list what it adds")
    inspect.add_argument("package")
    inspect.set_defaults(func=cmd_inspect)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
