"""Single-use PDF child protocol, shared by source and frozen applications."""
import base64
import json
import os
import sys

from .analyze import MAX_BYTES, analyze


def main():
    try:
        if os.name != "nt":
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        data = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES or not data.startswith(b"%PDF-"):
            raise ValueError("PDF child requires a PDF of at most 64 MiB")
        result = analyze(data, "source.pdf")
        for child in result["children"]:
            child["data"] = base64.b64encode(child["data"]).decode("ascii")
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        sys.stdout.buffer.flush()
    except Exception as exc:
        sys.stdout.buffer.write(json.dumps({"error": str(exc)[:1000]}).encode("utf-8"))
        sys.stdout.buffer.flush()
        raise SystemExit(1)
