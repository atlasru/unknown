"""Verify PDF parsing in the private frozen subprocess, without a Python dependency."""
import argparse
import hashlib
import http.client
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from pathlib import Path


def pdf_fixture():
    text = b'BT /F1 12 Tf 20 700 Td (Frozen PDF source: 192.0.2.5) Tj ET'
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(text)).encode() + b' >>\nstream\n' + text + b'\nendstream',
    ]
    result = b'%PDF-1.4\n'; offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result)); result += f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(result)
    result += f'xref\n0 {len(objects) + 1}\n'.encode() + b'0000000000 65535 f \n'
    result += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return result + f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--engine', default='build/engine/atlas-engine.exe' if os.name == 'nt' else 'build/engine/atlas-engine'); args = parser.parse_args()
    binary = Path(args.engine).resolve()
    if not binary.is_file(): raise ValueError(f'Frozen engine does not exist: {binary}')
    with tempfile.TemporaryDirectory(prefix='atlas-frozen-verification-') as temporary:
        root = Path(temporary); source = root / 'probe.pdf'; source.write_bytes(pdf_fixture())
        token = os.urandom(32).hex()
        engine = subprocess.Popen([str(binary), '--data', str(root / 'workspace'), '--no-demo'], env={**os.environ, 'ATLAS_API_TOKEN':token}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            output = queue.Queue()
            threading.Thread(target=lambda:output.put(engine.stdout.readline()), daemon=True).start()
            ready = json.loads(output.get(timeout=30))
            if not ready.get('ready'): raise ValueError('Frozen engine did not become ready')
            def api(route, body=None):
                connection = http.client.HTTPConnection('127.0.0.1', ready['port'], timeout=30)
                connection.request('POST' if body is not None else 'GET', route, json.dumps(body) if body is not None else None, {'Authorization':'Bearer ' + token, 'Content-Type':'application/json'})
                response = connection.getresponse(); result = json.loads(response.read()); connection.close()
                if response.status != 200: raise ValueError(result)
                return result
            case_id = api('/cases', {'name':'FROZEN PDF VERIFICATION'})['id']
            api(f'/cases/{case_id}/import', {'paths':[str(source)]})
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                job = api('/jobs')[-1]
                if job['status'] != 'running': break
                time.sleep(.05)
            if job['status'] != 'completed' or job['imported'] != 1: raise ValueError(job)
            artifact = api(f'/cases/{case_id}/artifacts')['items'][0]
            detail = api(f'/cases/{case_id}/artifacts/{artifact["id"]}')
            if detail['metadata']['encoding'] != 'pdf-text' or '192.0.2.5' not in detail['text']: raise ValueError({'metadata':detail['metadata'], 'findings':detail['findings']})
            if artifact['sha256'] != hashlib.sha256(source.read_bytes()).hexdigest(): raise ValueError('Original PDF bytes were not preserved')
            if not api(f'/cases/{case_id}/verify', {})['ok']: raise ValueError('Frozen engine integrity check failed')
            print(json.dumps({'ok':True, 'frozen_pdf_subprocess':True, 'encoding':detail['metadata']['encoding'], 'original_sha256':artifact['sha256']}))
        finally:
            engine.stdin.close()
            try: engine.wait(timeout=35)
            except subprocess.TimeoutExpired: engine.kill(); engine.wait(); raise ValueError('Frozen engine did not shut down cleanly')

if __name__ == '__main__': main()
