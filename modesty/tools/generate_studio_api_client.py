#!/usr/bin/env python3
"""Generate Modesty's dependency-free Studio API operation manifest.

Usage: python3 tools/generate_studio_api_client.py --spec <downloaded OpenAPI>
The committed snapshot is public schema data, never OAuth credentials.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def generate(document):
    if not str(document.get("openapi", "")).startswith("3.1."):
        raise ValueError("Expected the published OpenAPI 3.1 document.")
    operations = {}
    for path, item in document.get("paths", {}).items():
        inherited = item.get("parameters", [])
        for method, source in item.items():
            if method not in METHODS:
                continue
            operation_id = source.get("operationId")
            if not isinstance(operation_id, str) or operation_id in operations:
                raise ValueError("Each operation needs a unique operationId.")
            operation = dict(source)
            operation["method"] = method.upper()
            operation["path"] = path
            operation["parameters"] = inherited + source.get("parameters", [])
            operations[operation_id] = operation
    if not operations:
        raise ValueError("The document contains no operations.")
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    return {"generated_from": "https://freestyle.audio/api/v1/openapi.json",
            "openapi": document["openapi"], "api_version": document.get("info", {}).get("version"),
            "schema_sha256": hashlib.sha256(canonical).hexdigest(),
            "components": document.get("components", {}), "operations": operations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=ROOT / "docs" / "studio-openapi.json")
    parser.add_argument("--output", type=Path, default=ROOT / "studio_api_operations.json")
    parser.add_argument("--snapshot", type=Path, default=ROOT / "docs" / "studio-openapi.json")
    args = parser.parse_args()
    document = json.loads(args.spec.read_text())
    manifest = generate(document)
    for path, value in [(args.output, manifest), (args.snapshot, document)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")
    print("Generated {} Studio API operations ({}).".format(len(manifest["operations"]), manifest["schema_sha256"][:12]))


if __name__ == "__main__":
    main()
