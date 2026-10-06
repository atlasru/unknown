import io
import json
import time
import zipfile
import pytest
from atlas.demo import generate
from atlas.importer import Importer

def wait(importer, job_id):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        job = importer.snapshot(job_id)
        if job['status'] != 'running':
            return job
        time.sleep(.02)
    raise AssertionError('Import timed out')

def run(store, case, paths):
    importer = Importer(store)
    try:
        return wait(importer, importer.start(case, [str(p) for p in paths])['id'])
    finally:
        importer.shutdown()

def test_demo_decoding_zip_beacons_and_duplicates(store, case, tmp_path):
    folder = generate(tmp_path / 'sources')
    first = run(store, case, [folder])
    assert first['status'] == 'completed' and first['skipped'] == 0
    assert first['imported'] == 11
    assert any(f['rule'] == 'NET-001' for f in store.findings(case))
    assert store.artifacts(case, 'name:decoded')['total'] == 2
    second = run(store, case, [folder])
    assert second['imported'] == 0 and second['duplicates'] == 7
    assert store.verify(case)['ok']

def test_archive_traversal_and_bomb_never_extracted(store, case, tmp_path):
    source = tmp_path / 'unsafe.zip'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('../escape.txt', 'bad')
        archive.writestr('C:/escape.txt', 'bad')
        archive.writestr('bomb.txt', b'a' * 2000000)
        archive.writestr('safe.log', '2026-10-06T08:00:00Z connect 192.0.2.1')
    job = run(store, case, [source])
    assert job['skipped'] == 3 and job['imported'] == 2
    assert not (tmp_path.parent / 'escape.txt').exists()
    assert store.artifacts(case, 'name:safe.log')['total'] == 1
    assert len(store.findings(case)) == 3

def test_nested_depth_limit(store, case, tmp_path):
    blob = b'leaf 192.0.2.1'
    for i in range(6):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive: archive.writestr(f'level-{i}.zip', blob)
        blob = buffer.getvalue()
    source = tmp_path / 'nested.zip'; source.write_bytes(blob)
    job = run(store, case, [source])
    assert job['imported'] == 4
    assert any('depth limit' in f['title'] for f in store.findings(case))

def test_symlink_and_own_workspace_skipped(store, case, tmp_path):
    source = tmp_path / 'target.log'; source.write_text('secret')
    link = tmp_path / 'link.log'
    try: link.symlink_to(source)
    except OSError: pytest.skip('Symlinks unavailable')
    job = run(store, case, [link, store.root])
    assert job['imported'] == 0 and job['skipped'] == 1

def test_parser_failure_preserves_original(store, case, tmp_path):
    source = tmp_path / 'broken.pdf'; source.write_bytes(b'%PDF-1.7\nnot a pdf')
    job = run(store, case, [source])
    assert job['imported'] == 1
    artifact = store.artifacts(case)['items'][0]
    assert artifact['metadata']['analysis_failed']
    assert store.blob(artifact['sha256']) == source.read_bytes()
    assert store.verify(case)['ok']

def test_pdf_background_import_has_private_child_protocol(store, case, tmp_path):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 20 700 Td (Background PDF source: 192.0.2.5) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    source = tmp_path / 'background.pdf'
    with source.open('wb') as target: writer.write(target)
    job = run(store, case, [source])
    assert job['imported'] == 1 and job['skipped'] == 0
    artifact = store.artifacts(case)['items'][0]
    detail = store.artifact(case, artifact['id'])
    assert detail['metadata']['encoding'] == 'pdf-text'
    assert '192.0.2.5' in detail['text']
    assert len(store.entities(case, '192.0.2.5')) == 1
    assert store.blob(artifact['sha256']) == source.read_bytes()
    assert store.verify(case)['ok']

def test_non_periodic_network_not_flagged(store, case, tmp_path):
    source = tmp_path / 'random.jsonl'
    source.write_text('\n'.join(json.dumps({'timestamp':f'2026-10-06T08:{minute:02d}:{seconds:02d}Z','event':'dns','query':'good.example','answer':'192.0.2.9'}) for minute, seconds in [(0,0),(0,8),(1,50),(2,9),(4,2),(8,50),(10,0)]))
    run(store, case, [source])
    assert not any(f['rule'] == 'NET-001' for f in store.findings(case))

def test_cancel_and_single_job_guard(store, case, tmp_path, monkeypatch):
    import atlas.importer as module
    original = module.isolated_analysis
    def slow(data, name): time.sleep(.1); return original(data, name)
    monkeypatch.setattr(module, 'isolated_analysis', slow)
    folder = tmp_path / 'many'; folder.mkdir()
    for i in range(20): (folder / f'{i}.txt').write_text(f'file {i}')
    importer = Importer(store)
    try:
        job = importer.start(case, [str(folder)])
        with pytest.raises(ValueError): importer.start(case, [str(folder)])
        importer.cancel(job['id'])
        result = wait(importer, job['id'])
        assert result['status'] == 'cancelled'
        assert result['imported'] < 20
        assert store.verify(case)['ok']
    finally: importer.shutdown()
