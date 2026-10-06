import http.client
import json
import threading
from http.server import ThreadingHTTPServer
import pytest
from atlas.server import Service, handler_for

@pytest.fixture
def api_server(tmp_path):
    token = 'test-' + 'a' * 64
    service = Service(tmp_path / 'server', token, demo=False)
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    yield server.server_port, token, service
    server.shutdown(); server.server_close(); service.close(); thread.join()

def request(api_server, method, path, body=None, auth=True, extra=None):
    port, token, _ = api_server
    connection = http.client.HTTPConnection('127.0.0.1', port)
    headers = {'Content-Type':'application/json'}
    if auth: headers['Authorization'] = 'Bearer ' + token
    headers.update(extra or {})
    connection.request(method, path, json.dumps(body) if body is not None else None, headers)
    response = connection.getresponse(); data = json.loads(response.read()); status = response.status; connection.close()
    return status, data

def test_auth_origin_and_host(api_server):
    assert request(api_server, 'GET', '/health', auth=False)[0] == 401
    assert request(api_server, 'GET', '/health', extra={'Origin':'https://evil.example'})[0] == 401
    assert request(api_server, 'GET', '/health', extra={'Host':'evil.example'})[0] == 403
    assert request(api_server, 'GET', '/health')[1]['ok']

def test_case_creation_and_validation(api_server):
    assert request(api_server, 'POST', '/cases', {'name':''})[0] == 400
    status, case = request(api_server, 'POST', '/cases', {'name':'API CASE'})
    assert status == 200
    assert request(api_server, 'GET', f"/cases/{case['id']}/summary")[1]['counts']['artifacts'] == 0
    assert request(api_server, 'GET', f"/cases/{case['id']}/artifacts?q=risk:invalid")[0] == 400
    assert request(api_server, 'POST', f"/cases/{case['id']}/verify", {})[1]['ok']

def test_unknown_and_bad_bodies(api_server):
    assert request(api_server, 'GET', '/not-an-endpoint')[0] == 404
    assert request(api_server, 'POST', '/cases', ['bad'])[0] == 400
    assert request(api_server, 'POST', '/cases', {'name':'OK'}, extra={'Content-Type':'text/plain'})[0] == 415

def test_api_import_graph_and_export(api_server, tmp_path):
    source = tmp_path / 'source.log'; source.write_text('2026-10-06T08:00:00Z connect https://test.example/path')
    case = request(api_server, 'POST', '/cases', {'name':'FLOW'})[1]['id']
    job = request(api_server, 'POST', f'/cases/{case}/import', {'paths':[str(source)]})[1]
    from test_importer import wait
    wait(api_server[2].importer, job['id'])
    assert request(api_server, 'GET', f'/cases/{case}/graph')[1]['nodes']
    assert request(api_server, 'GET', f'/cases/{case}/events')[1]['total'] == 1
    out = tmp_path / 'case.zip'
    assert request(api_server, 'POST', f'/cases/{case}/export', {'destination':str(out)})[0] == 200
    assert out.exists()
