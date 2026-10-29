"""Private, versioned TF-IDF + LSA vector retrieval. No remote embedding calls."""
from collections import Counter
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time

import numpy as np
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from threadpoolctl import threadpool_limits

from library import LibraryError, LibraryStore
from literature_ai import VERSION as PAPER_VERSION, encoded
from research_knowledge import NOTES, ALIASES

VERSION = 'research-rag-lsa-v1'
_lock = threading.Lock()


def tokens(text):
    terms = []
    for word in re.findall(r'[a-z][a-z0-9_-]+|[\u4e00-\u9fff]+', text.lower()):
        if '\u4e00' <= word[0] <= '\u9fff':
            terms.extend(word[i:i+n] for n in (2, 3) for i in range(len(word)-n+1))
        else:
            terms.append(word)
    return terms


def expanded(text):
    lower = text.lower()
    return text + ' ' + ' '.join(cn + ' ' + en for cn, en in ALIASES
                                if cn in text or any(w in lower for w in en.split() if len(w) > 5))


def vectorizer(**kwargs):
    return TfidfVectorizer(analyzer=tokens, sublinear_tf=True, dtype=np.float32, **kwargs)


def citations(value, retrieval):
    """Only server-resolved evidence IDs can become clickable references."""
    ids = value.get('evidence_ids', [])
    allowed = {s['id']: s for s in retrieval['sources']}
    if not isinstance(ids, list) or len(ids) > 8 or any(not isinstance(i, str) or i not in allowed for i in ids):
        raise ValueError('Unknown evidence ID')
    return [allowed[i] for i in dict.fromkeys(ids)]


class ResearchRAG:
    def __init__(self, library):
        self.library = library
        self.root = library.root / 'rag'
        self.root.mkdir(exist_ok=True)
        self.lock = threading.Lock()
        self.index = None

    def inventory(self):
        documents = {d['id']: d for d in self.library.catalog()['documents'] if d.get('pdf')}
        path = self.library.root / 'ai' / 'analysis.sqlite3'
        records = []
        if path.is_file():
            with closing(sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True, timeout=15)) as db:
                db.row_factory = sqlite3.Row
                records = [dict(r) for r in db.execute('SELECT id,sha,version,status,updated FROM papers ORDER BY id')]
        valid = [r for r in records if r['id'] in documents and r['sha'] == documents[r['id']]['pdf']
                 and r['version'] == PAPER_VERSION and r['status'] == 'ready']
        version = hashlib.sha256(encoded([VERSION, NOTES, ALIASES,
            [(r, documents[r['id']]['title']) for r in valid]]).encode()).hexdigest()
        return version, documents, valid

    def version(self):
        return self.inventory()[0]

    def chunks(self, documents, records):
        chunks = []
        for method, title, content in NOTES:
            chunks.append({'id': 'K' + str(len(chunks)+1), 'kind': 'curated', 'title': title,
                           'text': content, 'href': '#methods/' + method, 'document_id': 'curated:' + method,
                           'page': None, 'sha256': hashlib.sha256(content.encode()).hexdigest()})
        if records:
            path = self.library.root / 'ai' / 'analysis.sqlite3'
            with closing(sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True, timeout=15)) as db:
                for record in records:
                    row = db.execute('SELECT pages,result FROM papers WHERE id=? AND sha=? AND updated=? AND status=?',
                                     (record['id'], record['sha'], record['updated'], 'ready')).fetchone()
                    if not row:
                        raise LibraryError(409, '文献正在更新，请稍后重试')
                    document = documents[record['id']]
                    summary = json.loads(row[1] or '{}')
                    # Summaries/tags aid retrieval only; the supplied evidence remains PDF page text.
                    context = document['title'] + ' ' + ' '.join(summary.get('tags', [])) + ' ' + summary.get('summary', '')
                    for page in json.loads(row[0] or '[]'):
                        content = re.sub(r'\s+', ' ', page['text']).strip()
                        if len(content) < 50:
                            continue
                        for start in range(0, len(content), 780):
                            text = content[start:start+900]
                            if len(text) < 50:
                                continue
                            chunks.append({'id': 'P' + hashlib.sha256(encoded([record['id'], record['sha'], page['page'], start]).encode()).hexdigest()[:20],
                                           'kind': 'paper', 'document_id': record['id'], 'title': document['title'],
                                           'page': page['page'], 'text': text, 'context': context[:500],
                                           'sha256': record['sha'],
                                           'href': f"#literature/read/{record['id']}/{page['page']}"})
        return chunks

    def ensure(self):
        with self.lock:
            version, documents, records = self.inventory()
            if self.index and self.index['version'] == version:
                return self.index
            folder = self.root / version
            if not (folder / 'index.json').is_file():
                chunks = self.chunks(documents, records)
                texts = [c['text'] + ' ' + c.get('context', '') for c in chunks]
                tf = vectorizer(max_features=40000)
                with threadpool_limits(limits=1):
                    matrix = tf.fit_transform(texts)
                    dimensions = min(128, matrix.shape[0]-1, matrix.shape[1]-1)
                    svd = TruncatedSVD(n_components=dimensions, n_iter=5, random_state=710)
                    dense = normalize(svd.fit_transform(matrix))
                metadata = {'version': version, 'algorithm': VERSION, 'documents': len(records),
                            'pdf_pages': len({(c['document_id'], c['page']) for c in chunks if c['kind'] == 'paper'}),
                            'chunks_count': len(chunks), 'dimensions': dimensions, 'created': time.time(),
                            'vocabulary': {key: int(value) for key, value in tf.vocabulary_.items()}, 'chunks': chunks}
                # Each directory is immutable. Concurrent processes use the same content fingerprint.
                with tempfile.TemporaryDirectory(dir=self.root) as temp:
                    temp = Path(temp)
                    sparse.save_npz(temp / 'lexical.npz', matrix)
                    np.savez_compressed(temp / 'vectors.npz', dense=dense, components=svd.components_, idf=tf.idf_)
                    (temp / 'index.json').write_text(encoded(metadata), encoding='utf-8')
                    if self.version() != version:
                        raise LibraryError(409, '文献正在更新，索引未发布，请稍后重试')
                    if not folder.exists():
                        try:
                            os.rename(temp, folder)
                        except OSError:
                            if not (folder / 'index.json').is_file():
                                raise
            metadata = json.loads((folder / 'index.json').read_text(encoding='utf-8'))
            tf = vectorizer(vocabulary=metadata.pop('vocabulary'))
            with np.load(folder / 'vectors.npz', allow_pickle=False) as arrays:
                tf.idf_ = arrays['idf']
                dense, components = arrays['dense'], arrays['components']
            self.index = {**metadata, 'tf': tf, 'dense': dense, 'components': components,
                          'matrix': sparse.load_npz(folder / 'lexical.npz')}
            return self.index

    def retrieve(self, query, expected=None, *, kinds=None, top_k=None, document_ids=None, score_threshold=None):
        started = time.perf_counter()
        index = self.ensure()
        if expected and expected != index['version']:
            raise LibraryError(409, '知识库版本已变化，请重新提交以使用最新证据')
        with threadpool_limits(limits=1):
            q = index['tf'].transform([expanded(query[:6000])])
            lexical = (index['matrix'] @ q.T).toarray().ravel()
            latent = normalize(np.asarray(q @ index['components'].T))
            score = .65 * lexical + .35 * np.maximum(0, index['dense'] @ latent[0])
        chosen, counts = [], Counter()
        # Keep two project notes and up to five original-paper passages, diversified by paper.
        for kind, limit in [('curated', 2), ('paper', 5)]:
            if kinds is not None and kind not in kinds:
                continue
            if top_k is not None:
                limit = top_k
            subset = []
            for i in np.argsort(-score, kind='stable'):
                c = index['chunks'][i]
                if document_ids and c['document_id'] not in document_ids:
                    continue
                if score_threshold is not None and score[i] < score_threshold:
                    continue
                if c['kind'] != kind or lexical[i] < .025 or score[i] < .06 or counts[c['document_id']] >= 2:
                    continue
                # Overlapping windows from the same page add little independent evidence.
                if any(s['document_id'] == c['document_id'] and s['page'] == c['page'] for s in subset):
                    continue
                subset.append({k: v for k, v in c.items() if k != 'context'})
                subset[-1]['score'] = round(float(score[i]), 4)
                counts[c['document_id']] += 1
                if len(subset) == limit:
                    break
            chosen.extend(subset)
        if top_k is not None:
            chosen = sorted(chosen, key=lambda item: -item['score'])[:top_k]
        return {'version': index['version'], 'algorithm': VERSION, 'documents': index['documents'],
                'chunks': index['chunks_count'], 'dimensions': index['dimensions'],
                'retrieval_ms': round((time.perf_counter()-started)*1000, 1), 'sources': chosen,
                'notice': '文献片段是检索候选，须核对原文语境；项目知识卡不是文献结论。' if any(s['kind'] == 'paper' for s in chosen)
                          else '未检索到足够相关的原文证据，不应据此归纳文献共识。'}


def knowledge(server):
    with _lock:
        if not hasattr(server, 'research_rag'):
            server.research_rag = ResearchRAG(server.library)
    return server.research_rag


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--query', default='投入产出网络中心性强度与韧性冲击')
    args = parser.parse_args()
    rag = ResearchRAG(LibraryStore(args.root))
    result = rag.retrieve(args.query)
    print(encoded({**result, 'sources': [{k: v for k, v in s.items() if k != 'text'} for s in result['sources']]}))
