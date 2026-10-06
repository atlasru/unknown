from __future__ import annotations

import io
import multiprocessing
import os
import statistics
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

from .analyze import MAX_BYTES, analyze
from .store import Store, now, uid

MAX_FILES = 3000
MAX_JOB_BYTES = 512 * 1024 * 1024
MAX_DEPTH = 3


def pdf_worker(data, name, conn):
    try:
        if os.name != "nt":
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        conn.send((True, analyze(data, name)))
    except Exception as exc:
        conn.send((False, str(exc)[:1000]))
    finally:
        conn.close()


def isolated_analysis(data, name):
    if not data.startswith(b"%PDF-"):
        return analyze(data, name)
    ctx = multiprocessing.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=pdf_worker, args=(data, name, child), daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(25):
            raise ValueError("PDF analysis exceeded 25 seconds")
        ok, result = parent.recv()
        if not ok:
            raise ValueError("PDF analysis failed: " + result)
        return result
    finally:
        parent.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)


class Importer:
    def __init__(self, store: Store):
        self.store = store
        self.jobs = {}
        self.lock = threading.RLock()
        self.busy = threading.Lock()
        self.closed = False

    def snapshot(self, job_id=None):
        with self.lock:
            if job_id:
                if job_id not in self.jobs:
                    raise KeyError("Import job not found")
                return dict(self.jobs[job_id])
            return [dict(j) for j in self.jobs.values()][-30:]

    def cancel(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise KeyError("Import job not found")
            self.jobs[job_id]["cancelled"] = True
        return {"ok": True}

    def start(self, case_id, paths):
        self.store.case(case_id)
        if not isinstance(paths, list) or not paths or len(paths) > 3000 or any(not isinstance(p, str) for p in paths):
            raise ValueError("Choose between 1 and 3,000 paths")
        if not self.busy.acquire(blocking=False):
            raise ValueError("An import is already running; wait or cancel it")
        job_id = uid()
        with self.lock:
            self.jobs[job_id] = {"id": job_id, "case_id": case_id, "status": "running", "imported": 0,
                                 "duplicates": 0, "skipped": 0, "processed": 0, "bytes": 0, "current": "Discovering files…",
                                 "errors": [], "cancelled": False, "started": now(), "elapsed": 0}
            if len(self.jobs) > 100:
                oldest = next(iter(self.jobs))
                if oldest != job_id:
                    self.jobs.pop(oldest)
        thread = threading.Thread(target=self._run, args=(job_id, paths), daemon=True)
        thread.start()
        return self.snapshot(job_id)

    def _mutate(self, job_id, **values):
        with self.lock:
            self.jobs[job_id].update(values)

    def _inc(self, job_id, key, amount=1):
        with self.lock:
            self.jobs[job_id][key] += amount

    def _error(self, job_id, message):
        self._inc(job_id, "skipped")
        with self.lock:
            if len(self.jobs[job_id]["errors"]) < 200:
                self.jobs[job_id]["errors"].append(str(message)[:1000])

    def _stop(self, job_id):
        return self.closed or self.snapshot(job_id)["cancelled"]

    def _walk(self, paths, job_id):
        seen = set()
        count = 0
        for given in paths:
            path = Path(given).absolute()
            if path.is_symlink():
                self._error(job_id, f"Symlink skipped: {path}")
                continue
            stack = [path]
            while stack:
                if self._stop(job_id):
                    return
                item = stack.pop()
                if item.is_symlink():
                    continue
                try:
                    resolved = item.resolve()
                    if resolved.is_relative_to(self.store.root.resolve()):
                        continue
                    if resolved in seen:
                        continue
                    seen.add(resolved)
                    if item.is_dir():
                        stack.extend(sorted(item.iterdir(), reverse=True))
                        continue
                    if not item.is_file():
                        self._error(job_id, f"Not a regular file: {item}")
                        continue
                    count += 1
                    if count > MAX_FILES:
                        self._error(job_id, "Import stopped at 3,000 source files")
                        return
                    yield item
                except OSError as exc:
                    self._error(job_id, f"{item}: {exc}")

    def _run(self, job_id, paths):
        started = time.monotonic()
        try:
            for path in self._walk(paths, job_id):
                if self._stop(job_id):
                    break
                self._mutate(job_id, current=path.name)
                try:
                    if path.stat().st_size > MAX_BYTES:
                        raise ValueError("File exceeds 64 MiB")
                    with path.open("rb") as stream:
                        data = stream.read(MAX_BYTES + 1)
                    if len(data) > MAX_BYTES:
                        raise ValueError("File grew beyond 64 MiB during read")
                    self._import(job_id, data, path.name, str(path), None, "imported", 0)
                except Exception as exc:
                    self._error(job_id, f"{path.name}: {exc}")
            self._detect_beacons(self.snapshot(job_id)["case_id"])
            self._mutate(job_id, status="cancelled" if self._stop(job_id) else "completed", current="", elapsed=round(time.monotonic() - started, 2))
        except Exception as exc:
            self._error(job_id, exc)
            self._mutate(job_id, status="failed", current="", elapsed=round(time.monotonic() - started, 2))
        finally:
            self.busy.release()

    def _import(self, job_id, data, name, path, parent_id, relation, depth):
        job = self.snapshot(job_id)
        if self._stop(job_id):
            return
        if job["processed"] >= MAX_FILES or job["bytes"] + len(data) > MAX_JOB_BYTES:
            self._error(job_id, f"Analysis budget exceeded: {name}")
            return
        self._inc(job_id, "bytes", len(data))
        self._inc(job_id, "processed")
        warning = None
        try:
            result = isolated_analysis(data, name)
        except Exception as exc:
            # Preserve original bytes even when a parser fails.
            from .analyze import decode_text
            import hashlib
            text, encoding = decode_text(data)
            result = {"metadata": {"sha256": hashlib.sha256(data).hexdigest(), "extension": PurePosixPath(name).suffix.lstrip(".").lower() or "file", "size": len(data), "encoding": encoding, "analysis_failed": True},
                      "text": text, "occurrences": [], "events": [], "findings": [], "relations": [], "children": []}
            warning = str(exc)
        artifact_id, added = self.store.add_artifact(job["case_id"], name, path, data, result, parent_id, relation)
        self._inc(job_id, "imported" if added else "duplicates")
        if not added:
            return
        if warning:
            self.store.add_warning(job["case_id"], artifact_id, "Analysis incomplete", warning)
        if depth >= MAX_DEPTH:
            if result["children"] or data.startswith(b"PK\x03\x04"):
                self.store.add_warning(job["case_id"], artifact_id, "Nested analysis depth limit", "Maximum depth is 3. Original archive retained.")
            return
        for child in result["children"]:
            self._import(job_id, child["data"], child["name"], path + "!/" + child["name"], artifact_id, child["relation"], depth + 1)
        if zipfile.is_zipfile(io.BytesIO(data)):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for index, member in enumerate(archive.infolist()):
                    if self._stop(job_id):
                        break
                    if index >= 2000:
                        self.store.add_warning(job["case_id"], artifact_id, "Archive entry limit", "Only the first 2,000 entries are analyzed.")
                        break
                    if member.is_dir():
                        continue
                    try:
                        normalized = member.filename.replace("\\", "/")
                        parts = PurePosixPath(normalized).parts
                        if normalized.startswith("/") or ".." in parts or any(":" in p for p in parts):
                            raise ValueError("Unsafe archive path")
                        if member.file_size > MAX_BYTES or member.file_size > max(member.compress_size, 1) * 200:
                            raise ValueError("Archive expansion limit exceeded")
                        if self.snapshot(job_id)["bytes"] + member.file_size > MAX_JOB_BYTES:
                            raise ValueError("Job byte budget exceeded")
                        if (member.external_attr >> 16) & 0o170000 == 0o120000:
                            raise ValueError("Archive symlink skipped")
                        with archive.open(member) as stream:
                            child_data = stream.read(MAX_BYTES + 1)
                        if len(child_data) > MAX_BYTES:
                            raise ValueError("Archive member exceeds 64 MiB")
                        self._import(job_id, child_data, normalized, path + "!/" + normalized, artifact_id, "contains", depth + 1)
                    except Exception as exc:
                        self._error(job_id, f"{name}!/{member.filename}: {exc}")
                        self.store.add_warning(job["case_id"], artifact_id, "Archive member skipped", f"{member.filename}: {exc}")

    def _detect_beacons(self, case_id):
        # Periodicity analysis is within one file and one observed destination.
        entities = self.store.rows("SELECT id,value FROM entities WHERE case_id=? AND kind IN('domain','ip')", (case_id,))
        for entity in entities[:5000]:
            records = self.store.rows("SELECT DISTINCT e.artifact_id,e.timestamp,e.line FROM occurrences o JOIN events e ON e.artifact_id=o.artifact_id AND e.line=o.line WHERE o.entity_id=? AND e.kind='network' ORDER BY e.artifact_id,e.timestamp", (entity["id"],))
            grouped = {}
            for record in records:
                grouped.setdefault(record["artifact_id"], []).append(record)
            for artifact_id, items in grouped.items():
                if len(items) < 6:
                    continue
                times = sorted({datetime.fromisoformat(i["timestamp"]).timestamp() for i in items})
                intervals = [b - a for a, b in zip(times, times[1:])]
                if len(intervals) < 5:
                    continue
                mean = statistics.mean(intervals)
                cv = statistics.pstdev(intervals) / mean if mean > 0 else 1
                if mean < 5 or mean > 3600 or cv > .12:
                    continue
                title = f"Periodic network activity · {entity['value']}"
                if self.store.rows("SELECT id FROM findings WHERE artifact_id=? AND rule='NET-001' AND title=?", (artifact_id, title)):
                    continue
                with self.store.lock, self.store.db:
                    self.store.db.execute("INSERT INTO findings(id,artifact_id,rule,severity,title,line,detail) VALUES(?,?,?,?,?,?,?)",
                                          (uid(), artifact_id, "NET-001", "medium", title, items[0]["line"],
                                           f"{len(times)} timestamps; mean interval {mean:.1f}s; coefficient of variation {cv:.3f}. Scheduled benign traffic can also be periodic."))
                    self.store.audit(case_id, "analysis.periodicity", {"artifact_id": artifact_id, "entity_id": entity["id"], "interval": mean, "cv": cv})

    def shutdown(self):
        self.closed = True
        deadline = time.monotonic() + 30
        while self.busy.locked() and time.monotonic() < deadline:
            time.sleep(.05)
