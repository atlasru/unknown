from __future__ import annotations

import collections
import hashlib
import html
import json
import os
import shlex
import sqlite3
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def uid() -> str:
    return uuid.uuid4().hex


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def packed(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), name TEXT NOT NULL,
 path TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, extension TEXT NOT NULL, imported TEXT NOT NULL,
 parent_id TEXT REFERENCES artifacts(id), relation TEXT NOT NULL, metadata TEXT NOT NULL, text TEXT NOT NULL,
 UNIQUE(case_id,path,sha256));
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), kind TEXT NOT NULL,
 value TEXT NOT NULL, UNIQUE(case_id,kind,value));
CREATE TABLE IF NOT EXISTS occurrences(id INTEGER PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 entity_id TEXT NOT NULL REFERENCES entities(id), line INTEGER NOT NULL, offset INTEGER NOT NULL, excerpt TEXT NOT NULL,
 UNIQUE(artifact_id,entity_id,line,offset));
CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), source TEXT NOT NULL,
 target TEXT NOT NULL, relation TEXT NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(id), line INTEGER NOT NULL,
 UNIQUE(case_id,source,target,relation,artifact_id,line));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 timestamp TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, summary TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings(id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
 rule TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, line INTEGER NOT NULL, detail TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), node_id TEXT NOT NULL,
 body TEXT NOT NULL, created TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), timestamp TEXT NOT NULL,
 action TEXT NOT NULL, payload TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS artifact_fts USING fts5(id UNINDEXED, name, text, tokenize='unicode61');
CREATE INDEX IF NOT EXISTS artifacts_case ON artifacts(case_id);
CREATE INDEX IF NOT EXISTS occurrences_entity ON occurrences(entity_id);
CREATE INDEX IF NOT EXISTS occurrences_artifact ON occurrences(artifact_id);
CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
CREATE INDEX IF NOT EXISTS events_source ON events(artifact_id,line);
CREATE INDEX IF NOT EXISTS edges_case ON edges(case_id);
CREATE INDEX IF NOT EXISTS edges_source ON edges(artifact_id,line);
CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id,seq);
PRAGMA user_version=1;
"""


class Store:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / "evidence"
        self.blobs.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "atlas.sqlite", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=5000")
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if version > 1:
            raise ValueError("This workspace was created by a newer Atlas version")
        self.db.executescript(SCHEMA)

    def close(self):
        with self.lock:
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self.db.close()

    def rows(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def case(self, case_id):
        result = self.rows("SELECT * FROM cases WHERE id=?", (case_id,))
        if not result:
            raise KeyError("Case not found")
        return result[0]

    def audit(self, case_id, action, payload):
        timestamp = now()
        previous = self.db.execute("SELECT hash FROM audit WHERE case_id=? ORDER BY seq DESC LIMIT 1", (case_id,)).fetchone()
        previous = previous[0] if previous else "0" * 64
        body = packed(payload)
        digest = hashlib.sha256(packed([case_id, timestamp, action, body, previous]).encode()).hexdigest()
        self.db.execute("INSERT INTO audit(case_id,timestamp,action,payload,prev,hash) VALUES(?,?,?,?,?,?)", (case_id, timestamp, action, body, previous, digest))

    def create_case(self, name, description=""):
        name = str(name).strip()[:120]
        if not name:
            raise ValueError("Case name is required")
        case_id = uid()
        with self.lock, self.db:
            self.db.execute("INSERT INTO cases VALUES(?,?,?,?)", (case_id, name, now(), str(description)[:5000]))
            self.audit(case_id, "case.created", {"name": name, "description": description})
        return self.case(case_id)

    def cases(self):
        return self.rows("SELECT c.*, (SELECT count(*) FROM artifacts a WHERE a.case_id=c.id) AS artifacts FROM cases c ORDER BY created DESC")

    def persist_blob(self, data: bytes) -> str:
        digest = hashlib.sha256(data).hexdigest()
        folder = self.blobs / digest[:2]
        folder.mkdir(exist_ok=True)
        path = folder / digest
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("Stored evidence is corrupt; run integrity verification")
            return digest
        temp = folder / ("." + uid() + ".tmp")
        try:
            with temp.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
        return digest

    def add_artifact(self, case_id, name, path, data, result, parent_id=None, relation="imported"):
        digest = self.persist_blob(data)
        if digest != result["metadata"]["sha256"]:
            raise ValueError("Analyzer hash mismatch")
        with self.lock, self.db:
            self.case(case_id)
            existing = self.db.execute("SELECT id FROM artifacts WHERE case_id=? AND path=? AND sha256=?", (case_id, path, digest)).fetchone()
            if existing:
                return existing[0], False
            artifact_id = uid()
            meta = result["metadata"]
            self.db.execute("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (artifact_id, case_id, name, path, digest, len(data), meta["extension"], now(), parent_id, relation, packed(meta), result["text"]))
            self.db.execute("INSERT INTO artifact_fts(id,name,text) VALUES(?,?,?)", (artifact_id, name, result["text"]))
            entity_cache = {}

            def entity(kind, value):
                key = (kind, value)
                if key in entity_cache:
                    return entity_cache[key]
                row = self.db.execute("SELECT id FROM entities WHERE case_id=? AND kind=? AND value=?", (case_id, kind, value)).fetchone()
                entity_id = row[0] if row else uid()
                if row is None:
                    self.db.execute("INSERT INTO entities VALUES(?,?,?,?)", (entity_id, case_id, kind, value))
                entity_cache[key] = entity_id
                return entity_id

            for occurrence in result["occurrences"]:
                entity_id = entity(occurrence["kind"], occurrence["value"])
                self.db.execute("INSERT OR IGNORE INTO occurrences(artifact_id,entity_id,line,offset,excerpt) VALUES(?,?,?,?,?)",
                                (artifact_id, entity_id, occurrence["line"], occurrence["offset"], occurrence["excerpt"]))
            for entity_id in entity_cache.values():
                self.db.execute("INSERT OR IGNORE INTO edges(case_id,source,target,relation,artifact_id,line) VALUES(?,?,?,?,?,0)",
                                (case_id, artifact_id, entity_id, "mentions", artifact_id))
            for rel in result["relations"]:
                source = entity(rel["source_kind"], rel["source_value"])
                target = entity(rel["target_kind"], rel["target_value"])
                self.db.execute("INSERT OR IGNORE INTO edges(case_id,source,target,relation,artifact_id,line) VALUES(?,?,?,?,?,?)",
                                (case_id, source, target, rel["relation"], artifact_id, rel["line"]))
            if parent_id:
                self.db.execute("INSERT OR IGNORE INTO edges(case_id,source,target,relation,artifact_id,line) VALUES(?,?,?,?,?,0)",
                                (case_id, parent_id, artifact_id, relation, artifact_id))
            self.db.executemany("INSERT INTO events(artifact_id,timestamp,kind,line,summary) VALUES(?,?,?,?,?)",
                                [(artifact_id, e["timestamp"], e["kind"], e["line"], e["summary"]) for e in result["events"]])
            self.db.executemany("INSERT INTO findings(id,artifact_id,rule,severity,title,line,detail) VALUES(?,?,?,?,?,?,?)",
                                [(uid(), artifact_id, f["rule"], f["severity"], f["title"], f["line"], f["detail"]) for f in result["findings"]])
            self.audit(case_id, "evidence.imported", {"id": artifact_id, "name": name, "path": path, "sha256": digest,
                                                     "size": len(data), "parent_id": parent_id, "relation": relation})
        return artifact_id, True

    def add_warning(self, case_id, artifact_id, title, detail, rule="IMPORT-001"):
        with self.lock, self.db:
            self.db.execute("INSERT INTO findings(id,artifact_id,rule,severity,title,line,detail) VALUES(?,?,?,?,?,0,?)",
                            (uid(), artifact_id, rule, "low", title, str(detail)[:2000]))
            self.audit(case_id, "analysis.warning", {"artifact_id": artifact_id, "title": title, "detail": str(detail)[:2000]})

    def summary(self, case_id):
        case = self.case(case_id)
        with self.lock:
            counts = {}
            for table in ("artifacts", "entities", "edges", "notes"):
                counts[table] = self.db.execute(f"SELECT count(*) FROM {table} WHERE case_id=?", (case_id,)).fetchone()[0]
            for table in ("events", "findings"):
                counts[table] = self.db.execute(f"SELECT count(*) FROM {table} x JOIN artifacts a ON a.id=x.artifact_id WHERE a.case_id=?", (case_id,)).fetchone()[0]
            counts["bytes"] = self.db.execute("SELECT coalesce(sum(size),0) FROM artifacts WHERE case_id=?", (case_id,)).fetchone()[0]
        severities = self.rows("SELECT severity, count(*) AS count FROM findings f JOIN artifacts a ON a.id=f.artifact_id WHERE a.case_id=? AND status='open' GROUP BY severity", (case_id,))
        types = self.rows("SELECT kind, count(*) AS count FROM entities WHERE case_id=? GROUP BY kind ORDER BY count DESC", (case_id,))
        bounds = self.rows("SELECT min(cast(strftime('%s',timestamp) AS INTEGER)) AS start,max(cast(strftime('%s',timestamp) AS INTEGER)) AS end FROM events e JOIN artifacts a ON a.id=e.artifact_id WHERE a.case_id=?", (case_id,))[0]
        import math
        bucket_seconds = max(60, math.ceil(((bounds["end"] or 0) - (bounds["start"] or 0) + 60) / (300 * 60)) * 60)
        bins = self.rows("SELECT strftime('%Y-%m-%dT%H:%M',(cast(strftime('%s',timestamp) AS INTEGER)/?)*?,'unixepoch') AS time,count(*) AS count FROM events e JOIN artifacts a ON a.id=e.artifact_id WHERE a.case_id=? GROUP BY time ORDER BY time", (bucket_seconds, bucket_seconds, case_id))
        hubs = self.rows("SELECT e.*,count(DISTINCT o.artifact_id) AS sources,count(o.id) AS mentions FROM entities e JOIN occurrences o ON o.entity_id=e.id WHERE e.case_id=? GROUP BY e.id ORDER BY sources DESC,mentions DESC LIMIT 8", (case_id,))
        return {"case": case, "counts": counts, "severities": severities, "types": types, "timeline": bins, "bucket_seconds": bucket_seconds, "hubs": hubs}

    def artifacts(self, case_id, query="", limit=500, offset=0):
        conditions = ["a.case_id=?"]
        args = [case_id]
        words = []
        try:
            tokens = shlex.split(query)
        except ValueError:
            raise ValueError("Unclosed quote in search query")
        for token in tokens:
            key, sep, value = token.partition(":")
            if sep and key == "ext":
                conditions.append("a.extension=?")
                args.append(value.lower().lstrip("."))
            elif sep and key == "sha256":
                conditions.append("a.sha256 LIKE ?")
                args.append(value + "%")
            elif sep and key == "risk":
                if value not in ("high", "medium", "low"):
                    raise ValueError("risk must be high, medium or low")
                conditions.append("EXISTS(SELECT 1 FROM findings f WHERE f.artifact_id=a.id AND f.severity=? AND f.status='open')")
                args.append(value)
            elif sep and key == "has":
                if value not in {"ip", "domain", "url", "email", "cve", "sha256", "sha1", "md5"}:
                    raise ValueError("Unknown entity type for has:")
                conditions.append("EXISTS(SELECT 1 FROM occurrences o JOIN entities e ON e.id=o.entity_id WHERE o.artifact_id=a.id AND e.kind=?)")
                args.append(value)
            elif sep and key == "name":
                conditions.append("a.name LIKE ? ESCAPE '\\'")
                args.append("%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
            else:
                words.append(token)
        if words:
            conditions.append("a.id IN(SELECT id FROM artifact_fts WHERE artifact_fts MATCH ?)")
            args.append(" AND ".join('"' + word.replace('"', '""') + '"' for word in words))
        where = " AND ".join(conditions)
        count = self.rows("SELECT count(*) AS n FROM artifacts a WHERE " + where, args)[0]["n"]
        rows = self.rows("SELECT a.id,a.name,a.path,a.sha256,a.size,a.extension,a.imported,a.parent_id,a.relation,a.metadata,"
                         "(SELECT count(*) FROM occurrences o WHERE o.artifact_id=a.id) AS mentions,"
                         "(SELECT count(*) FROM findings f WHERE f.artifact_id=a.id AND f.status='open') AS findings "
                         "FROM artifacts a WHERE " + where + " ORDER BY imported DESC,name LIMIT ? OFFSET ?", args + [min(max(int(limit), 1), 1000), max(int(offset), 0)])
        for row in rows:
            row["metadata"] = json.loads(row["metadata"])
        return {"items": rows, "total": count}

    def artifact(self, case_id, artifact_id):
        rows = self.rows("SELECT * FROM artifacts WHERE case_id=? AND id=?", (case_id, artifact_id))
        if not rows:
            raise KeyError("Evidence not found")
        row = rows[0]
        row["metadata"] = json.loads(row["metadata"])
        row["entities"] = self.rows("SELECT e.*,count(*) AS mentions FROM entities e JOIN occurrences o ON e.id=o.entity_id WHERE o.artifact_id=? GROUP BY e.id ORDER BY mentions DESC LIMIT 500", (artifact_id,))
        row["findings"] = self.rows("SELECT * FROM findings WHERE artifact_id=? ORDER BY severity", (artifact_id,))
        row["versions"] = self.rows("SELECT id,sha256,imported FROM artifacts WHERE case_id=? AND path=? ORDER BY imported DESC", (case_id, row["path"]))
        row["hex"] = self.blob(row["sha256"])[:512].hex()
        return row

    def blob(self, digest):
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid hash")
        return (self.blobs / digest[:2] / digest).read_bytes()

    def entities(self, case_id, query="", kind="", limit=1000, offset=0):
        where = "e.case_id=? AND e.value LIKE ?"
        args = [case_id, "%" + query + "%"]
        if kind:
            where += " AND e.kind=?"
            args.append(kind)
        return self.rows("SELECT e.*,count(o.id) AS mentions,count(DISTINCT o.artifact_id) AS sources FROM entities e LEFT JOIN occurrences o ON o.entity_id=e.id WHERE " + where + " GROUP BY e.id ORDER BY sources DESC,mentions DESC,e.value LIMIT ? OFFSET ?", args + [min(int(limit), 5000), max(int(offset), 0)])

    def entity(self, case_id, entity_id):
        rows = self.rows("SELECT * FROM entities WHERE case_id=? AND id=?", (case_id, entity_id))
        if not rows:
            raise KeyError("Entity not found")
        row = rows[0]
        row["occurrences"] = self.rows("SELECT o.*,a.name FROM occurrences o JOIN artifacts a ON a.id=o.artifact_id WHERE o.entity_id=? ORDER BY a.name,o.line LIMIT 1000", (entity_id,))
        row["edges"] = self.rows("SELECT * FROM edges WHERE case_id=? AND (source=? OR target=?) LIMIT 500", (case_id, entity_id, entity_id))
        return row

    def graph(self, case_id, limit=1500):
        limit = min(max(int(limit), 10), 5000)
        entities = self.entities(case_id, limit=limit)
        artifacts = self.artifacts(case_id, limit=min(limit, 1000))["items"]
        nodes = [{"id": a["id"], "label": a["name"], "kind": "artifact", "weight": a["mentions"], "findings": a["findings"]} for a in artifacts]
        nodes += [{"id": e["id"], "label": e["value"], "kind": e["kind"], "weight": e["mentions"], "sources": e["sources"]} for e in entities]
        temporal_artifacts = {r["artifact_id"]: r for r in self.rows("SELECT e.artifact_id,min(e.timestamp) AS first_seen,max(e.timestamp) AS last_seen FROM events e JOIN artifacts a ON a.id=e.artifact_id WHERE a.case_id=? GROUP BY e.artifact_id", (case_id,))}
        temporal_entities = {r["entity_id"]: r for r in self.rows("SELECT o.entity_id,min(ev.timestamp) AS first_seen,max(ev.timestamp) AS last_seen FROM occurrences o JOIN events ev ON ev.artifact_id=o.artifact_id AND ev.line=o.line JOIN entities en ON en.id=o.entity_id WHERE en.case_id=? GROUP BY o.entity_id", (case_id,))}
        for node in nodes:
            temporal = (temporal_artifacts if node["kind"] == "artifact" else temporal_entities).get(node["id"])
            node["first_seen"] = temporal["first_seen"] if temporal else None
            node["last_seen"] = temporal["last_seen"] if temporal else None
        ids = {n["id"] for n in nodes}
        placeholders = ",".join("?" for _ in ids) or "NULL"
        node_args = [case_id, *ids, *ids]
        edges = self.rows(f"SELECT source,target,relation,count(*) AS weight,min(artifact_id) AS artifact_id,min(line) AS line FROM edges WHERE case_id=? AND source IN({placeholders}) AND target IN({placeholders}) GROUP BY source,target,relation", node_args)
        edge_times = {(r["source"], r["target"], r["relation"]): r["first_seen"] for r in self.rows(f"SELECT ed.source,ed.target,ed.relation,min(ev.timestamp) AS first_seen FROM edges ed JOIN events ev ON ev.artifact_id=ed.artifact_id AND ev.line=ed.line WHERE ed.case_id=? AND ed.source IN({placeholders}) AND ed.target IN({placeholders}) GROUP BY ed.source,ed.target,ed.relation", node_args)}
        for row in self.rows(f"SELECT o.artifact_id,o.entity_id,min(ev.timestamp) AS first_seen FROM occurrences o JOIN events ev ON ev.artifact_id=o.artifact_id AND ev.line=o.line JOIN artifacts a ON a.id=o.artifact_id WHERE a.case_id=? AND o.artifact_id IN({placeholders}) AND o.entity_id IN({placeholders}) GROUP BY o.artifact_id,o.entity_id", node_args):
            edge_times[(row["artifact_id"], row["entity_id"], "mentions")] = row["first_seen"]
        # Untimed evidence is always present in replay. It does not acquire an invented timestamp.
        for edge in edges:
            edge["first_seen"] = edge_times.get((edge["source"], edge["target"], edge["relation"]))
        counts = self.rows("SELECT (SELECT count(*) FROM artifacts WHERE case_id=?) + (SELECT count(*) FROM entities WHERE case_id=?) AS n", (case_id, case_id))[0]["n"]
        timestamps = [r["first_seen"] for r in temporal_artifacts.values()] + [r["last_seen"] for r in temporal_artifacts.values()]
        return {"nodes": nodes, "edges": edges, "total": counts, "truncated": counts > len(nodes), "time_range": [min(timestamps), max(timestamps)] if timestamps else None}

    def path(self, case_id, source, target):
        # Shortest path in the complete stored graph, not just the display subset.
        edges = self.rows("SELECT source,target,relation,artifact_id,line FROM edges WHERE case_id=?", (case_id,))
        adjacency = collections.defaultdict(list)
        for edge in edges:
            adjacency[edge["source"]].append((edge["target"], edge))
            adjacency[edge["target"]].append((edge["source"], edge))
        queue = collections.deque([source])
        previous = {source: None}
        while queue:
            node = queue.popleft()
            if node == target:
                break
            for neighbor, edge in adjacency[node]:
                if neighbor not in previous:
                    previous[neighbor] = (node, edge)
                    queue.append(neighbor)
        if target not in previous:
            return {"nodes": [], "edges": []}
        nodes, result_edges = [target], []
        while previous[nodes[-1]] is not None:
            parent, edge = previous[nodes[-1]]
            nodes.append(parent)
            result_edges.append(edge)
        return {"nodes": nodes[::-1], "edges": result_edges[::-1]}

    def events(self, case_id, query="", kind="", start="", end="", limit=500, offset=0):
        where = "a.case_id=? AND e.summary LIKE ?"
        args = [case_id, "%" + query + "%"]
        for column, op, value in (("kind", "=", kind), ("timestamp", ">=", start), ("timestamp", "<=", end)):
            if value:
                where += f" AND e.{column}{op}?"
                args.append(value)
        count = self.rows("SELECT count(*) AS n FROM events e JOIN artifacts a ON a.id=e.artifact_id WHERE " + where, args)[0]["n"]
        rows = self.rows("SELECT e.*,a.name FROM events e JOIN artifacts a ON a.id=e.artifact_id WHERE " + where + " ORDER BY timestamp,e.id LIMIT ? OFFSET ?", args + [min(max(int(limit), 1), 2000), max(int(offset), 0)])
        return {"items": rows, "total": count}

    def findings(self, case_id):
        return self.rows("SELECT f.*,a.name FROM findings f JOIN artifacts a ON a.id=f.artifact_id WHERE a.case_id=? ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,f.title", (case_id,))

    def set_finding(self, case_id, finding_id, status):
        if status not in ("open", "reviewed", "dismissed"):
            raise ValueError("Invalid finding status")
        with self.lock, self.db:
            cursor = self.db.execute("UPDATE findings SET status=? WHERE id=? AND artifact_id IN(SELECT id FROM artifacts WHERE case_id=?)", (status, finding_id, case_id))
            if cursor.rowcount == 0:
                raise KeyError("Finding not found")
            self.audit(case_id, "finding.status", {"id": finding_id, "status": status})
        return {"ok": True}

    def notes(self, case_id, node_id=""):
        return self.rows("SELECT * FROM notes WHERE case_id=?" + (" AND node_id=?" if node_id else "") + " ORDER BY created DESC", (case_id, node_id) if node_id else (case_id,))

    def add_note(self, case_id, node_id, body, tag=""):
        if not str(body).strip():
            raise ValueError("Note cannot be empty")
        note_id = uid()
        with self.lock, self.db:
            self.case(case_id)
            if node_id and not self.rows("SELECT id FROM artifacts WHERE case_id=? AND id=? UNION ALL SELECT id FROM entities WHERE case_id=? AND id=?", (case_id, node_id, case_id, node_id)):
                raise KeyError("Note target not found in this case")
            self.db.execute("INSERT INTO notes VALUES(?,?,?,?,?,?)", (note_id, case_id, node_id, str(body)[:20_000], now(), str(tag)[:80]))
            self.audit(case_id, "note.created", {"id": note_id, "node_id": node_id, "body": str(body)[:20_000], "tag": str(tag)[:80]})
        return {"id": note_id}

    def history(self, case_id):
        return self.rows("SELECT * FROM audit WHERE case_id=? ORDER BY seq DESC LIMIT 1000", (case_id,))

    def verify(self, case_id):
        self.case(case_id)
        records = self.rows("SELECT * FROM audit WHERE case_id=? ORDER BY seq", (case_id,))
        previous = "0" * 64
        failures = []
        for record in records:
            expected = hashlib.sha256(packed([case_id, record["timestamp"], record["action"], record["payload"], previous]).encode()).hexdigest()
            if expected != record["hash"] or previous != record["prev"]:
                failures.append({"type": "audit", "seq": record["seq"]})
            previous = record["hash"]
        artifacts = self.rows("SELECT id,sha256 FROM artifacts WHERE case_id=?", (case_id,))
        for artifact in artifacts:
            try:
                valid = hashlib.sha256(self.blob(artifact["sha256"])).hexdigest() == artifact["sha256"]
            except OSError:
                valid = False
            if not valid:
                failures.append({"type": "evidence", "id": artifact["id"]})
        # Check the database evidence records against the hash-chained import records.
        imported = {}
        for record in records:
            if record["action"] != "evidence.imported":
                continue
            try:
                payload = json.loads(record["payload"])
                imported[payload["id"]] = payload
            except (ValueError, TypeError, KeyError):
                failures.append({"type": "audit_payload", "seq": record["seq"]})
        for artifact in self.rows("SELECT id,name,path,sha256,size,parent_id,relation FROM artifacts WHERE case_id=?", (case_id,)):
            if artifact != imported.get(artifact["id"]):
                failures.append({"type": "record", "id": artifact["id"]})
        return {"ok": not failures, "audit_records": len(records), "evidence_files": len(artifacts), "head": previous, "failures": failures,
                "scope": "Source bytes, evidence metadata and audit chain. Not an external signature or independent timestamp."}

    def report(self, case_id):
        summary = self.summary(case_id)
        esc = lambda x: html.escape(str(x))
        findings = "".join(f'<tr><td>{esc(f["severity"])}</td><td>{esc(f["title"])}</td><td>{esc(f["name"])}:{f["line"]}</td><td>{esc(f["status"])}</td><td>{esc(f["detail"])}</td></tr>' for f in self.findings(case_id))
        artifacts = "".join(f'<tr><td>{esc(a["name"])}</td><td>{a["size"]}</td><td><code>{a["sha256"]}</code></td></tr>' for a in self.artifacts(case_id, limit=1000)["items"])
        notes = "".join(f'<article><small>{esc(n["created"])} · {esc(n["tag"])}</small><p>{esc(n["body"])}</p></article>' for n in self.notes(case_id))
        return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Atlas · {esc(summary["case"]["name"])}</title>
<style>body{{font:15px system-ui;color:#172338;background:#f4f7fc;margin:40px auto;max-width:1200px;padding:24px}}h1{{font-size:36px}}table{{border-collapse:collapse;width:100%;background:white}}td,th{{padding:12px;border:1px solid #d9e1ec;text-align:left;overflow-wrap:anywhere}}code{{font-size:11px}}small{{color:#607088}}article{{padding:16px;background:white;margin:12px 0}}p{{white-space:pre-wrap}}.meta{{color:#50617b}}</style>
<h1>{esc(summary["case"]["name"])}</h1><p class="meta">Atlas 1.0.0 · Generated {esc(now())} · UTC</p><p>{esc(summary["case"]["description"])}</p>
<p>{summary["counts"]["artifacts"]} evidence files · {summary["counts"]["entities"]} entities · {summary["counts"]["events"]} events</p>
<h2>Analyst notes</h2>{notes}<h2>Heuristic findings</h2><p>Indicators for review; no automated malware verdict.</p><table><thead><tr><th>Severity</th><th>Finding</th><th>Evidence</th><th>Status</th><th>Details</th></tr></thead><tbody>{findings}</tbody></table>
<h2>Evidence manifest (first 1,000; complete list in case.json)</h2><table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>{artifacts}</tbody></table></html>'''

    def export(self, case_id, destination):
        with self.lock:
            self.case(case_id)
            manifest = {"format": "atlas-evidence-bundle", "version": 1, "exported": now(), "case": self.case(case_id), "integrity": self.verify(case_id)}
            if not manifest["integrity"]["ok"]:
                raise ValueError("Integrity verification failed. Repair the workspace before exporting.")
            for table in ("artifacts", "entities", "edges", "notes", "audit"):
                manifest[table] = self.rows(f"SELECT * FROM {table} WHERE case_id=?", (case_id,))
            for table in ("occurrences", "events", "findings"):
                manifest[table] = self.rows(f"SELECT x.* FROM {table} x JOIN artifacts a ON a.id=x.artifact_id WHERE a.case_id=?", (case_id,))
            temp = Path(str(destination) + "." + uid() + ".tmp")
            try:
                with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as bundle:
                    bundle.writestr("case.json", json.dumps(manifest, indent=2, ensure_ascii=False))
                    bundle.writestr("report.html", self.report(case_id))
                    for digest in sorted({a["sha256"] for a in manifest["artifacts"]}):
                        bundle.writestr("evidence/" + digest, self.blob(digest))
                os.replace(temp, destination)
            finally:
                temp.unlink(missing_ok=True)
        return {"ok": True, "path": str(destination), "files": len(manifest["artifacts"])}
