"""Newman JSON CLI adapter for ChainLab's private, read-only knowledge service."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:8787/api/internal/toolbench-kb'


def request(operation, payload=None):
    token = os.environ.get('CHAINLAB_KB_BRIDGE_TOKEN', '')
    if not token or token.startswith('${'):
        raise ValueError('课题组知识库连接凭据未配置')
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(BASE + '/' + operation, data=data, headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
    })
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=25) as response:
        return json.load(response)


def run(command, payload):
    if command == 'retrieve':
        return request('retrieve', payload)
    if command not in ('doctor', 'health', 'list-kbs', 'list-datasets'):
        raise ValueError('Unsupported knowledge operation')
    catalog = request('catalog')
    datasets = catalog['datasets']
    common = {'success': True, 'provider': 'chainlab', 'provider_type': 'chainlab',
              'base_url': '/workspace.html#literature', 'version': catalog['version']}
    if command == 'health':
        return {**common, 'status': 'ready', 'detail': {'datasets': len(datasets)}}
    if command == 'list-datasets':
        return {**common, 'datasets': datasets, 'total': len(datasets)}
    kbs = [{'id': d['id'], 'display_name': d['name'], 'description': d['description'],
            'provider_dataset_ids': [d['id']], 'aliases': [d['name']]} for d in datasets]
    return {**common, 'command': command, 'api_key_present': True, 'knowledge_bases': kbs,
            'defaults': {'score_threshold': 0.06, 'page_size': 5}, 'warnings': []}


def main():
    try:
        payload = json.load(sys.stdin) if len(sys.argv) > 1 and sys.argv[1] in ('retrieve', 'list-datasets') else {}
        result = run(sys.argv[1] if len(sys.argv) > 1 else 'doctor', payload)
    except urllib.error.HTTPError as exc:
        result = {'success': False, 'provider': 'chainlab', 'error': {
            'type': 'provider_request_error', 'message': f'课题组知识库请求失败（HTTP {exc.code}）', 'retryable': exc.code >= 500}}
    except (OSError, ValueError, IndexError):
        result = {'success': False, 'provider': 'chainlab', 'error': {
            'type': 'provider_connection_error', 'message': '课题组知识库暂不可用，请稍后重试', 'retryable': True}}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
