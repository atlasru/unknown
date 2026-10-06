"""Independently verify an Atlas export using only Python's standard library."""
import hashlib
import json
import sys
import zipfile

def packed(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))

def verify(path):
    failures = []
    with zipfile.ZipFile(path) as bundle:
        manifest = json.loads(bundle.read('case.json'))
        if manifest.get('format') != 'atlas-evidence-bundle' or manifest.get('version') != 1:
            raise ValueError('Unsupported bundle format')
        case_id = manifest['case']['id']
        previous = '0' * 64
        imports = {}
        for record in sorted(manifest['audit'], key=lambda r: r['seq']):
            expected = hashlib.sha256(packed([case_id, record['timestamp'], record['action'], record['payload'], previous]).encode()).hexdigest()
            if record['case_id'] != case_id or expected != record['hash'] or previous != record['prev']:
                failures.append('audit:' + str(record['seq']))
            previous = record['hash']
            if record['action'] == 'evidence.imported':
                payload = json.loads(record['payload']); imports[payload['id']] = payload
        for artifact in manifest['artifacts']:
            digest = artifact['sha256']
            if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                failures.append('invalid-hash:' + artifact['id']); continue
            try:
                observed = hashlib.sha256(bundle.read('evidence/' + digest)).hexdigest()
            except KeyError:
                observed = None
            if observed != digest: failures.append('evidence:' + artifact['id'])
            metadata = {k: artifact[k] for k in ('id', 'name', 'path', 'sha256', 'size', 'parent_id', 'relation')}
            if metadata != imports.get(artifact['id']): failures.append('record:' + artifact['id'])
    return {'ok': not failures, 'evidence_files': len(manifest['artifacts']), 'audit_records': len(manifest['audit']), 'head': previous, 'failures': failures}

if __name__ == '__main__':
    try:
        result = verify(sys.argv[1]); print(json.dumps(result, indent=2)); sys.exit(0 if result['ok'] else 1)
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(1)
