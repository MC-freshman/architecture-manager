"""Platform-owned MCP facade. Maintenance challenge is separate from business runs."""
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import uuid


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def receipt(config_path, arguments):
    path = Path(config_path).resolve()
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    platform_root = Path(config['platformRoot']).resolve()
    if path.parent.parent != platform_root or config['platform'] != arguments.get('platformId'):
        raise ValueError('wrong platform')
    pins = {key: {'path': config[key], 'sha256': digest(Path(config[key]) / 'SHA256SUMS')} for key in ('runner', 'contracts', 'scannerRelease')}
    pin_sha = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    counts = {}
    for repo in ('tool', 'agent', 'software'):
        registry = json.loads((Path(config[repo + 'Root']) / 'registry.json').read_text(encoding='utf-8-sig'))
        counts[repo] = sum(len(value) for value in registry.values() if isinstance(value, list))
    return {'schema': 'architecture-client-receipt/v1', 'challenge': arguments['challenge'], 'platformId': config['platform'], 'configSha256': digest(path), 'versionsSha256': pin_sha, 'service': 'platform-owned-mcp-facade', 'registriesRead': counts, 'agent': None, 'workflow': None, 'businessRunExecuted': False}


def main():
    config_path = sys.argv[1]
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if 'id' not in request:
                continue
            method = request.get('method')
            if method == 'initialize':
                result = {'protocolVersion': '2024-11-05', 'serverInfo': {'name': 'architecture-platform', 'version': '0.4.0'}, 'capabilities': {'tools': {}}}
            elif method == 'tools/list':
                result = {'tools': [{'name': 'architecture_probe', 'description': 'Read-only onboarding challenge; no business run', 'inputSchema': {'type': 'object', 'required': ['challenge', 'platformId'], 'properties': {'challenge': {'type': 'string'}, 'platformId': {'type': 'string'}}}}, {'name': 'architecture_list', 'description': 'Read registered workflows, agents and software current pointers', 'inputSchema': {'type': 'object', 'properties': {}}}, {'name': 'architecture_run', 'description': 'Forward a pinned runner protocol request; prompt output is produced by the business client', 'inputSchema': {'type': 'object', 'required': ['request'], 'properties': {'request': {'type': 'object'}}}}]}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_probe':
                value = receipt(config_path, request['params']['arguments'])
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_list':
                config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
                value = {repo: json.loads((Path(config[repo + 'Root']) / 'registry.json').read_text(encoding='utf-8-sig')) for repo in ('tool', 'agent', 'software')}
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_run':
                config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
                protocol = request['params']['arguments']['request']
                if protocol.get('operation') not in ('prepare', 'next', 'submit', 'status', 'stop', 'delegate'):
                    raise ValueError('unsupported runner operation')
                if protocol.get('operation') == 'prepare' and protocol.get('payload', {}).get('platform') != config['platform']:
                    raise ValueError('wrong platform')
                directory = Path(config['platformRoot']) / 'runtime' / 'maintenance' / 'client-requests'
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / (uuid.uuid4().hex + '.json'); path.write_text(json.dumps(protocol), encoding='utf-8')
                child = subprocess.run([sys.executable, '-B', str(Path(config['runner']) / 'cli.py'), '--config', config_path, '--request', str(path)], capture_output=True, timeout=600)
                value = json.loads(child.stdout.decode('utf-8').strip().splitlines()[-1])
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': not value.get('ok')}
            else:
                raise ValueError('unsupported method')
            print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
        except Exception as exc:
            print(json.dumps({'jsonrpc': '2.0', 'id': request.get('id'), 'error': {'code': -32602, 'message': str(exc)}}), flush=True)


if __name__ == '__main__':
    main()
