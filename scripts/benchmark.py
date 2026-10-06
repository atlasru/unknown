"""Reproducible corpus benchmark. Results measure this machine; no hard-coded claims."""
import argparse
import json
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
from atlas.importer import Importer
from atlas.store import Store

parser = argparse.ArgumentParser()
parser.add_argument('--files', type=int, default=100)
parser.add_argument('--events-per-file', type=int, default=500)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='atlas-benchmark-') as temporary:
    root = Path(temporary); sources = root / 'sources'; sources.mkdir()
    base = datetime(2026, 10, 6, tzinfo=timezone.utc)
    for f in range(args.files):
        with (sources / f'network-{f:04}.jsonl').open('w') as stream:
            for e in range(args.events_per_file):
                index = f * args.events_per_file + e
                host = index % 5000
                stream.write(json.dumps({'timestamp':(base + timedelta(seconds=index)).isoformat(), 'event':'dns',
                                         'src_ip': f'10.20.{f // 254}.{f % 254 + 1}', 'query':f'service-{host}.example',
                                         'answer':f'203.0.{(host // 254) % 254}.{host % 254 + 1}'}) + '\n')
    store = Store(root / 'workspace'); case = store.create_case('BENCHMARK')['id']; importer = Importer(store)
    started = time.perf_counter(); job = importer.start(case, [str(sources)])
    while importer.snapshot(job['id'])['status'] == 'running': time.sleep(.05)
    imported = time.perf_counter() - started
    result = {'parameters':vars(args), 'import_seconds':round(imported, 3), 'job':importer.snapshot(job['id'])}
    for label, operation in [('summary', lambda:store.summary(case)), ('fts_search', lambda:store.artifacts(case, 'service-2048.example')), ('graph', lambda:store.graph(case)), ('integrity', lambda:store.verify(case))]:
        started = time.perf_counter(); value = operation(); elapsed = time.perf_counter() - started
        result[label + '_seconds'] = round(elapsed, 4)
        if label == 'summary': result['counts'] = value['counts']
        if label == 'fts_search': result['search_matches'] = value['total']
        if label == 'graph': result['graph_display'] = {'nodes':len(value['nodes']), 'links':len(value['edges']), 'truncated':value['truncated']}
        if label == 'integrity': result['integrity_ok'] = value['ok']
    importer.shutdown(); store.close()
    print(json.dumps(result, indent=2))
