"""Bounded, deterministic static analysis. Input is data, never executed."""
from __future__ import annotations

import base64
import collections
import csv
import hashlib
import io
import ipaddress
import json
import math
import re
import struct
from pathlib import PurePosixPath
from urllib.parse import urlsplit, urlunsplit

MAX_BYTES = 64 * 1024 * 1024
MAX_TEXT = 4_000_000
MAX_OCCURRENCES = 20_000
MAX_EVENTS = 10_000

PATTERNS = [
    ("url", re.compile(r"\b(?:https?|hxxps?)://[^\s<>\"'\x00]+", re.I)),
    ("email", re.compile(r"\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+(?:\.|\[\.\]))+[A-Z]{2,63}\b", re.I)),
    ("ip", re.compile(r"(?<![\w.])(?:\d{1,3}(?:\.|\[\.\])){3}\d{1,3}(?![\w.])")),
    ("domain", re.compile(r"(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.|\[\.\]))+(?:[a-z]{2,24})(?![\w.-])", re.I)),
    ("sha256", re.compile(r"(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])", re.I)),
    ("sha1", re.compile(r"(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])", re.I)),
    ("md5", re.compile(r"(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])", re.I)),
    ("cve", re.compile(r"\bCVE-\d{4}-\d{4,8}\b", re.I)),
]
TIMESTAMP = re.compile(r"\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)\b")
RULES = [
    ("SCRIPT-001", "high", "Encoded PowerShell command", r"(?i)(?:powershell|pwsh)[^\n]{0,200}-(?:enc(?:odedcommand)?|e)\s+[A-Za-z0-9+/=]{16,}"),
    ("SCRIPT-002", "high", "Download followed by execution", r"(?i)(?:curl|wget|Invoke-WebRequest)[^\n]{0,400}(?:\|\s*(?:sh|bash|iex)|Invoke-Expression)"),
    ("SCRIPT-003", "medium", "Credential access reference", r"(?i)\b(?:lsass\.exe|sekurlsa|mimikatz|Login Data|SAM\\|/etc/shadow)\b"),
    ("SCRIPT-004", "medium", "Persistence mechanism reference", r"(?i)(?:CurrentVersion\\Run|schtasks\s+/create|crontab\s+-|LaunchAgents/)"),
    ("SCRIPT-005", "high", "Defense evasion reference", r"(?i)(?:Set-MpPreference\s+-Disable|wevtutil\s+cl\s|vssadmin\s+delete\s+shadows)"),
    ("LOG-001", "medium", "Authentication failure", r"(?i)(?:authentication failed|failed password|login failed|invalid credentials)"),
    ("LOG-002", "low", "Security control alert", r"(?i)(?:blocked by|quarantined|suspicious activity|malware detected)"),
]


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = collections.Counter(data)
    n = len(data)
    return round(-sum((c / n) * math.log2(c / n) for c in counts.values()), 4)


def canonical(kind: str, value: str) -> str | None:
    value = value.replace("[.]", ".").replace("(.)", ".").strip().rstrip(".,;)]}")
    if kind == "ip":
        try:
            return str(ipaddress.IPv4Address(value))
        except ValueError:
            return None
    if kind == "url":
        value = re.sub(r"^hxxp", "http", value, flags=re.I)
        try:
            u = urlsplit(value)
            if not u.hostname or u.scheme.lower() not in ("http", "https"):
                return None
            host = u.hostname.encode("idna").decode().lower()
            port = u.port
            if port and port not in (80 if u.scheme.lower() == "http" else 443,):
                host += f":{port}"
            if u.username or u.password:
                host = (u.username or "") + (":" + u.password if u.password else "") + "@" + host
            return urlunsplit((u.scheme.lower(), host, u.path or "/", u.query, ""))[:2048]
        except (ValueError, UnicodeError):
            return None
    if kind == "domain":
        # Avoid interpreting file extensions and version strings as infrastructure.
        if value.rsplit(".", 1)[-1].lower() in {"exe", "dll", "txt", "json", "csv", "log", "pdf", "zip", "py", "ps1", "js", "bat", "png", "jpg", "bin", "db", "sqlite", "md", "html", "xml", "docx", "xlsx", "gz", "tar"}:
            return None
    return value.upper() if kind == "cve" else value.lower()


def extract(text: str, delimiter: str | None = None) -> list[dict]:
    occurrences = []
    # Precompute line starts once; avoid O(matches * text length).
    import bisect
    starts = [0] + [m.end() for m in re.finditer("\n", text)]
    seen = set()
    for kind, pattern in PATTERNS:
        for match in pattern.finditer(text):
            candidate = match.group()
            if kind == "url" and delimiter:
                line_start = text.rfind("\n", 0, match.start()) + 1
                # CSV delimiters terminate unquoted values; commas inside quoted URLs remain valid.
                if text[line_start:match.start()].count('"') % 2 == 0:
                    candidate = candidate.split(delimiter, 1)[0]
            value = canonical(kind, candidate)
            if value is None:
                continue
            key = (kind, value, match.start())
            if key in seen:
                continue
            seen.add(key)
            line_index = bisect.bisect_right(starts, match.start()) - 1
            line_start = starts[line_index]
            line_end = text.find("\n", match.end())
            if line_end < 0:
                line_end = len(text)
            occurrences.append({"kind": kind, "value": value, "line": line_index + 1,
                                "offset": match.start(), "excerpt": text[max(line_start, match.start() - 160):min(line_end, match.end() + 160)]})
            if len(occurrences) >= MAX_OCCURRENCES:
                return occurrences
    return occurrences


def pe_metadata(data: bytes) -> dict:
    if len(data) < 64 or data[:2] != b"MZ":
        return {}
    offset = struct.unpack_from("<I", data, 0x3c)[0]
    if offset > len(data) - 24 or data[offset:offset + 4] != b"PE\0\0":
        return {"format": "DOS/MZ", "valid_pe": False}
    machine, count, timestamp, _, _, optional_size, characteristics = struct.unpack_from("<HHIIIHH", data, offset + 4)
    sections = []
    for i in range(min(count, 96)):
        pos = offset + 24 + optional_size + i * 40
        if pos + 40 > len(data):
            break
        name, virtual_size, va, raw_size, raw_offset, _, _, _, _, flags = struct.unpack_from("<8sIIIIIIHHI", data, pos)
        section = data[raw_offset:min(raw_offset + raw_size, len(data))]
        sections.append({"name": name.rstrip(b"\0").decode("ascii", "replace"), "size": raw_size,
                         "entropy": entropy(section), "rwx": flags & 0xE0000000 == 0xE0000000})
    return {"format": "PE", "valid_pe": True, "architecture": {0x8664: "x64", 0x14c: "x86", 0xaa64: "ARM64"}.get(machine, hex(machine)),
            "sections": sections, "compile_timestamp": timestamp, "characteristics": characteristics}


def decode_text(data: bytes) -> tuple[str, str]:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", "replace")[:MAX_TEXT], "utf-16"
    if len(data) > 4 and data[1:4096:2].count(0) > min(len(data) // 2, 2048) * .65:
        return data.decode("utf-16-le", "replace")[:MAX_TEXT], "utf-16-le"
    sample = data[:8192]
    if b"\0" not in sample:
        try:
            return data.decode("utf-8-sig")[:MAX_TEXT], "utf-8"
        except UnicodeError:
            return data.decode("cp1252", "replace")[:MAX_TEXT], "cp1252"
    ascii_strings = [m.group().decode("ascii") for m in re.finditer(rb"[\x20-\x7e]{6,}", data)]
    wide_strings = [m.group().decode("utf-16-le") for m in re.finditer(rb"(?:[\x20-\x7e]\x00){6,}", data)]
    return "\n".join(ascii_strings + wide_strings)[:MAX_TEXT], "binary-strings"


def analyze(data: bytes, name: str) -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("File exceeds the 64 MiB analysis limit")
    metadata = {"sha256": hashlib.sha256(data).hexdigest(), "sha1": hashlib.sha1(data).hexdigest(),
                "md5": hashlib.md5(data).hexdigest(), "entropy": entropy(data), "size": len(data)}
    pe = pe_metadata(data)
    metadata.update(pe)
    ext = PurePosixPath(name.replace("\\", "/")).suffix.lower().lstrip(".") or "file"
    findings = []
    children = []
    if data.startswith(b"PK\x03\x04"):
        import zipfile
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            metadata.update({"format": "ZIP", "entries": len(archive.infolist())})
        text, encoding = "", "zip-container"
    elif data.startswith(b"%PDF-"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            text, encoding = "", "encrypted-pdf"
            findings.append({"rule": "FILE-004", "severity": "low", "title": "Encrypted PDF: content unavailable", "line": 0, "detail": "Import an unencrypted copy to index its content."})
        else:
            texts = []
            total = 0
            for page in reader.pages[:200]:
                t = (page.extract_text() or "")[:200_000]
                texts.append(t)
                total += len(t)
                if total >= MAX_TEXT:
                    break
            text, encoding = "\n".join(texts)[:MAX_TEXT], "pdf-text"
        metadata.update({"format": "PDF", "pages": len(reader.pages)})
    else:
        text, encoding = decode_text(data)
    metadata.update({"encoding": encoding, "extension": ext, "text_truncated": len(text) >= MAX_TEXT})
    if metadata["entropy"] >= 7.2 and len(data) > 4096 and pe:
        findings.append({"rule": "FILE-001", "severity": "medium", "title": "High entropy executable", "line": 0,
                         "detail": "May be packed or encrypted. Entropy is a heuristic, not a malware verdict."})
    if pe and ext not in ("exe", "dll", "sys", "scr", "ocx", "efi"):
        findings.append({"rule": "FILE-002", "severity": "high", "title": "Executable disguised as another file type", "line": 0,
                         "detail": f"MZ/PE header with .{ext} filename."})
    for section in pe.get("sections", []):
        if section["rwx"]:
            findings.append({"rule": "FILE-003", "severity": "high", "title": "Writable executable section", "line": 0, "detail": section["name"]})
    for rule, severity, title, pattern in RULES:
        for match in list(re.finditer(pattern, text))[:100]:
            findings.append({"rule": rule, "severity": severity, "title": title,
                             "line": text.count("\n", 0, match.start()) + 1, "detail": match.group()[:600]})
    for i, match in enumerate(list(re.finditer(r"(?i)-(?:enc(?:odedcommand)?|e)\s+([A-Za-z0-9+/]{16,}={0,2})", text))[:8]):
        try:
            decoded = base64.b64decode(match.group(1), validate=True)
            if len(decoded) > 512_000:
                continue
            decoded_text = decoded.decode("utf-16-le") if b"\0" in decoded[:32] else decoded.decode("utf-8")
            children.append({"name": f"decoded-command-{i + 1}.ps1", "data": decoded_text.encode("utf-8"),
                             "relation": "decoded", "origin_line": text.count("\n", 0, match.start()) + 1})
        except (ValueError, UnicodeError):
            pass
    delimiter = None
    if ext == "csv":
        try:
            delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;\t").delimiter
        except csv.Error:
            delimiter = ","
    occurrences = extract(text, delimiter)
    events = []
    for lineno, line in enumerate(text.splitlines(), 1):
        match = TIMESTAMP.search(line)
        if not match:
            continue
        from datetime import datetime, timezone
        try:
            dt = datetime.fromisoformat(match.group(1).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            timestamp = dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")
        except ValueError:
            continue
        lower = line.lower()
        kind = "auth" if any(s in lower for s in ("login", "authentication", "password")) else "network" if any(s in lower for s in ("dns", "connect", "http", "src_ip", "dst_ip", "beacon")) else "process" if any(s in lower for s in ("process", "powershell", "command", "pid")) else "event"
        events.append({"timestamp": timestamp, "line": lineno, "kind": kind, "summary": line[:1200]})
        if len(events) >= MAX_EVENTS:
            break
    # Domain/host relationships retain the line and excerpt of the originating URL/email.
    relations = []
    for occurrence in list(occurrences):
        if occurrence["kind"] not in ("url", "email"):
            continue
        host = urlsplit(occurrence["value"]).hostname if occurrence["kind"] == "url" else occurrence["value"].split("@")[-1]
        if host:
            kind = "ip" if canonical("ip", host) else "domain"
            occurrences.append({**occurrence, "kind": kind, "value": host,
                                "offset": occurrence["offset"] + max(0, occurrence["value"].find(host))})
            relations.append({"source_kind": occurrence["kind"], "source_value": occurrence["value"], "target_kind": kind,
                              "target_value": host, "relation": "hosted_on" if occurrence["kind"] == "url" else "mail_domain", "line": occurrence["line"]})
    # Structured JSONL DNS / network records: no speculative cross-file edges.
    observed = {(o["kind"], o["value"], o["line"]) for o in occurrences}
    for lineno, line in enumerate(text.splitlines(), 1):
        if not line.lstrip().startswith("{"):
            continue
        try:
            record = json.loads(line)
            if not isinstance(record, dict):
                continue
            domain = record.get("query") or record.get("domain")
            address = record.get("answer") or record.get("dst_ip")
            if isinstance(domain, str) and isinstance(address, str) and canonical("ip", address):
                domain = canonical("domain", domain)
                address = canonical("ip", address)
                if domain:
                    for kind, value in (("domain", domain), ("ip", address)):
                        if (kind, value, lineno) not in observed:
                            occurrences.append({"kind": kind, "value": value, "line": lineno, "offset": 0, "excerpt": line[:400]})
                            observed.add((kind, value, lineno))
                    relations.append({"source_kind": "domain", "source_value": domain, "target_kind": "ip", "target_value": address, "relation": "resolves_to", "line": lineno})
        except (ValueError, TypeError):
            pass
    return {"metadata": metadata, "text": text, "occurrences": occurrences[:MAX_OCCURRENCES], "events": events,
            "findings": findings[:1000], "relations": relations[:5000], "children": children}
