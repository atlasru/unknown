"""Authenticated loopback API; the desktop renderer never receives its token."""
from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .demo import generate
from .importer import Importer
from .store import Store

MAX_BODY = 2 * 1024 * 1024


class Service:
    def __init__(self, root, token, demo=True):
        if len(token) < 32:
            raise ValueError("API token must be at least 32 characters")
        self.token = token
        self.store = Store(root)
        self.importer = Importer(self.store)
        if demo and not self.store.cases():
            folder = generate(self.store.root.parent / (self.store.root.name + "-demo"))
            case = self.store.create_case("NORTHSTAR / 017", "Synthetic incident · Finance endpoint · 6 October 2026. All infrastructure is reserved for documentation.")
            self.store.add_note(case["id"], "", "Start with the relationship graph. Follow cdn.northstar.example into endpoint and network evidence, then inspect the decoded PowerShell command. Compare the authentication burst with the network timeline.", "briefing")
            job = self.importer.start(case["id"], [str(folder)])
            while self.importer.snapshot(job["id"])["status"] == "running":
                time.sleep(.03)

    def dispatch(self, method, path, params, body):
        def param(key, default=""):
            return params.get(key, [default])[0]

        if path == "/health" and method == "GET":
            return {"ok": True, "version": "1.0.0", "fts5": True}
        if path == "/cases":
            if method == "GET":
                return self.store.cases()
            if method == "POST":
                return self.store.create_case(body.get("name", ""), body.get("description", ""))
        if path == "/jobs" and method == "GET":
            return self.importer.snapshot()
        match = re.fullmatch(r"/jobs/([a-f0-9]{32})/cancel", path)
        if match and method == "POST":
            return self.importer.cancel(match[1])
        match = re.fullmatch(r"/cases/([a-f0-9]{32})/([a-z]+)(?:/([a-f0-9]{32}))?", path)
        if not match:
            raise KeyError("Endpoint not found")
        case_id, resource, item_id = match.groups()
        self.store.case(case_id)
        if method == "GET":
            if resource == "summary":
                return self.store.summary(case_id)
            if resource == "artifacts":
                return self.store.artifact(case_id, item_id) if item_id else self.store.artifacts(case_id, param("q"), param("limit", 500), param("offset", 0))
            if resource == "entities":
                return self.store.entity(case_id, item_id) if item_id else self.store.entities(case_id, param("q"), param("kind"), param("limit", 1000), param("offset", 0))
            if resource == "graph":
                return self.store.graph(case_id, param("limit", 1500))
            if resource == "path":
                return self.store.path(case_id, param("source"), param("target"))
            if resource == "events":
                return self.store.events(case_id, param("q"), param("kind"), param("start"), param("end"), param("limit", 500), param("offset", 0))
            if resource == "findings":
                return self.store.findings(case_id)
            if resource == "notes":
                return self.store.notes(case_id, param("node"))
            if resource == "history":
                return self.store.history(case_id)
            if resource == "report":
                return {"html": self.store.report(case_id)}
        if method == "POST":
            if resource == "import":
                return self.importer.start(case_id, body.get("paths", []))
            if resource == "notes":
                return self.store.add_note(case_id, body.get("node_id", ""), body.get("body", ""), body.get("tag", ""))
            if resource == "findings" and item_id:
                return self.store.set_finding(case_id, item_id, body.get("status", ""))
            if resource == "verify":
                return self.store.verify(case_id)
            if resource == "export":
                destination = body.get("destination")
                if not isinstance(destination, str) or not Path(destination).is_absolute():
                    raise ValueError("Export destination must be an absolute path")
                return self.store.export(case_id, destination)
        raise KeyError("Endpoint not found")

    def close(self):
        self.importer.shutdown()
        self.store.close()


def handler_for(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Atlas/1.0"

        def log_message(self, *_args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def send_json(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def handle_api(self, method):
            # Browser pages cannot use the service: no CORS, reject Origin, token held in main.
            auth = self.headers.get("Authorization", "")
            if self.headers.get("Origin") or not hmac.compare_digest(auth, "Bearer " + service.token):
                self.send_json(401, {"error": "Unauthorized"})
                return
            host = self.headers.get("Host", "")
            if host != f"127.0.0.1:{self.server.server_port}":
                self.send_json(403, {"error": "Invalid Host"})
                return
            try:
                parsed = urlsplit(self.path)
                body = {}
                if method == "POST":
                    length = int(self.headers.get("Content-Length", "0"))
                    if length < 0 or length > MAX_BODY:
                        self.send_json(413, {"error": "Request exceeds 2 MiB"})
                        return
                    if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                        self.send_json(415, {"error": "Content-Type must be application/json"})
                        return
                    body = json.loads(self.rfile.read(length) or b"{}")
                    if not isinstance(body, dict):
                        raise ValueError("JSON body must be an object")
                result = service.dispatch(method, parsed.path, parse_qs(parsed.query), body)
                self.send_json(200, result)
            except KeyError as exc:
                self.send_json(404, {"error": str(exc).strip("'")})
            except (ValueError, TypeError) as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                print(f"Atlas API error: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
                self.send_json(500, {"error": "Operation failed. Check the application log."})

        def do_GET(self):
            self.handle_api("GET")

        def do_POST(self):
            self.handle_api("POST")

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Atlas local evidence engine")
    parser.add_argument("--data", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-demo", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            service = Service(folder, "self-test-" + "0" * 40)
            case_id = service.store.cases()[0]["id"]
            result = service.store.verify(case_id)
            assert result["ok"], result
            assert service.store.summary(case_id)["counts"]["artifacts"] >= 10
            service.close()
            print(json.dumps({"ok": True, "version": "1.0.0", "integrity": result}))
        return
    token = os.environ.get("ATLAS_API_TOKEN", "")
    service = Service(args.data, token, not args.no_demo)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(service))
    server.daemon_threads = True
    stopping = threading.Event()

    def shutdown(*_):
        if not stopping.is_set():
            stopping.set()
            threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    # Parent lifetime is bound to stdin; works on Windows where SIGTERM is not graceful.
    def parent_watch():
        try:
            sys.stdin.buffer.read()
        finally:
            shutdown()

    if not sys.stdin.isatty():
        threading.Thread(target=parent_watch, daemon=True).start()
    print(json.dumps({"ready": True, "port": server.server_port, "version": "1.0.0"}), flush=True)
    try:
        server.serve_forever(poll_interval=.1)
    finally:
        server.server_close()
        service.close()


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
