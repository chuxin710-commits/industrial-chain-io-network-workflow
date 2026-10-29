"""Read-only, scoped service bridge to the existing private research index."""
import hmac
import json
import os
from urllib.parse import urlsplit

CATALOG = {
    'chainlab-literature': ('paper', '课题组文献原文', '已解析 PDF 原文片段，保留页码与文献来源。'),
    'chainlab-methods': ('curated', '项目方法知识卡', '投入产出、网络与韧性方法说明；不是文献结论。'),
}


def retrieve(rag, payload):
    query = payload.get('query')
    ids = payload.get('knowledge_base_ids')
    top_k = payload.get('top_k', 5)
    threshold = payload.get('score_threshold')
    filters = payload.get('filters') or {}
    if not isinstance(query, str) or not query.strip() or len(query) > 6000:
        raise ValueError('查询须为 1 至 6000 字的文本')
    if not isinstance(ids, list) or not ids or any(not isinstance(k, str) for k in ids):
        raise ValueError('请选择有效的课题组知识库')
    aliases = {value[1]: key for key, value in CATALOG.items()}
    ids = [aliases.get(key, key) for key in ids]
    if any(key not in CATALOG for key in ids):
        raise ValueError('请选择有效的课题组知识库')
    if type(top_k) is not int or not 1 <= top_k <= 20:
        raise ValueError('top_k 须为 1 至 20 的整数')
    if threshold is not None and (type(threshold) not in (float, int) or not 0 <= threshold <= 1):
        raise ValueError('相似度阈值须在 0 至 1 之间')
    if not isinstance(filters, dict):
        raise ValueError('筛选条件无效')
    documents = filters.get('document_ids', [])
    if not isinstance(documents, list) or len(documents) > 100 or any(not isinstance(d, str) for d in documents):
        raise ValueError('文献筛选条件无效')
    if filters.get('metadata') or filters.get('metadata_condition'):
        raise ValueError('当前知识库不支持任意元数据筛选')
    options = payload.get('options') or {}
    if not isinstance(options, dict) or options.get('search_mode', 'hybrid') != 'hybrid':
        raise ValueError('当前知识库使用 TF-IDF + LSA 混合检索')
    result = rag.retrieve(query, kinds={CATALOG[k][0] for k in ids}, top_k=top_k,
                          document_ids=documents, score_threshold=threshold)
    sources = []
    for source in result['sources']:
        kb = 'chainlab-literature' if source['kind'] == 'paper' else 'chainlab-methods'
        sources.append({
            'id': source['id'], 'chunk_id': source['id'], 'knowledge_base_id': kb,
            'provider_knowledge_base_id': kb, 'document_id': source['document_id'],
            'document_name': source['title'], 'content': source['text'], 'score': source['score'],
            'source': {'uri': '/workspace.html' + source['href'], 'page': source['page']},
            'metadata': {'kind': source['kind'], 'sha256': source['sha256'], 'index_version': result['version']},
            'score_details': {'algorithm': result['algorithm']}, 'highlights': [],
        })
    return {'success': True, 'provider': 'chainlab', 'query': query, 'total': len(sources),
            'results': sources, 'warnings': [result['notice']], 'provider_latency_ms': round(result['retrieval_ms'])}


def handle(handler):
    token = os.environ.get('CHAINLAB_KB_BRIDGE_TOKEN', '')
    supplied = handler.headers.get('Authorization', '').removeprefix('Bearer ')
    if (handler.client_address[0] not in ('127.0.0.1', '::1') or not token
            or not hmac.compare_digest(token.encode(), supplied.encode())):
        handler.json_response(403, {'error': 'Private knowledge service'})
        return
    path = urlsplit(handler.path).path
    try:
        if handler.server.library is None:
            raise RuntimeError('Library unavailable')
        from research_rag import knowledge
        rag = knowledge(handler.server)
        if path == '/api/internal/toolbench-kb/catalog' and handler.command == 'GET':
            index = rag.ensure()
            datasets = []
            for key, (kind, name, description) in CATALOG.items():
                chunks = [c for c in index['chunks'] if c['kind'] == kind]
                datasets.append({'id': key, 'name': name, 'description': description,
                                 'document_count': len({c['document_id'] for c in chunks}),
                                 'chunk_count': len(chunks), 'status': 'ready',
                                 'embedding_model': index['algorithm']})
            handler.json_response(200, {'success': True, 'version': index['version'], 'datasets': datasets})
        elif path == '/api/internal/toolbench-kb/retrieve' and handler.command == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= 32768:
                raise ValueError('请求长度无效')
            payload = json.loads(handler.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('请求须为 JSON 对象')
            handler.json_response(200, retrieve(rag, payload))
        else:
            handler.json_response(404, {'error': 'Unknown knowledge operation'})
    except (ValueError, TypeError) as exc:
        handler.json_response(400, {'error': str(exc)})
    except Exception:
        handler.log_error('Toolbench knowledge retrieval unavailable')
        handler.json_response(503, {'error': '文献索引暂不可用，请稍后重试'})
