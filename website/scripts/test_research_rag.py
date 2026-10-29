"""Synthetic retrieval/grounding tests. No private texts or provider calls."""
from contextlib import closing
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from library import LibraryStore, LibraryError
from literature_ai import LiteratureAI
from research_rag import ResearchRAG, citations
from method_tutor import MethodTutor
from toolbench_kb import retrieve as bridge_retrieve, handle as bridge_handle


class RAGTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = LibraryStore(self.temp.name)
        self.ai = LiteratureAI(self.store)
        self.documents = []
        topics = [('级联失效与供应链韧性', '容量级联传播需要定义初始负载与容量裕度，节点失效引起下游连锁反应，恢复通过替代路径实现。'),
                  ('Direct input output networks', 'Input output networks describe interindustry production dependencies. Direct coefficients divide supplier transactions by buyer output. Network strength is not causal importance.'),
                  ('热带作物生物学', '叶绿素吸收光谱反映植物光合作用的生理变化，植物细胞的遗传基因受到季节温度影响。')]
        for i, (title, text) in enumerate(topics):
            doc = {'id': str(i+1)*32, 'title': title, 'pdf': str(i+1)*64, 'year': 2020, 'pages': 1}
            with closing(self.store.connect()) as db:
                db.execute('INSERT INTO documents VALUES(?,?)', (doc['id'], json.dumps(doc)))
                db.commit()
            self.ai.save_paper(doc, 'ready', {'summary': title, 'tags': [title]}, [{'page': 1, 'text': text*8}])
            self.documents.append(doc)
        self.rag = ResearchRAG(self.store)

    def tearDown(self):
        self.temp.cleanup()

    def test_real_vectors_persistence_and_physical_page(self):
        result = self.rag.retrieve('供应链韧性容量级联失效')
        papers = [s for s in result['sources'] if s['kind'] == 'paper']
        self.assertEqual(papers[0]['document_id'], self.documents[0]['id'])
        self.assertEqual(papers[0]['page'], 1)
        self.assertIn('/1', papers[0]['href'])
        self.assertEqual(result['documents'], 3)
        self.assertGreater(result['dimensions'], 1)
        other = ResearchRAG(self.store).retrieve('供应链韧性容量级联失效')
        self.assertEqual([s['id'] for s in result['sources']], [s['id'] for s in other['sources']])
        self.assertTrue(list(self.rag.root.rglob('vectors.npz')))
        self.assertEqual(len({(s['document_id'], s['page']) for s in papers}), len(papers))

    def test_bilingual_expansion_and_no_match(self):
        result = self.rag.retrieve('投入产出系数')
        self.assertIn(self.documents[1]['id'], [s['document_id'] for s in result['sources']])
        empty = self.rag.retrieve('zzzzqqqqxxxxxxxx')
        self.assertEqual(empty['sources'], [])
        self.assertIn('未检索', empty['notice'])

    def test_toolbench_preserves_source_and_filters_before_ranking(self):
        payload = {'query': '供应链韧性容量级联失效', 'knowledge_base_ids': ['chainlab-literature'],
                   'top_k': 3, 'score_threshold': 0.06}
        result = bridge_retrieve(self.rag, payload)
        self.assertTrue(result['success'])
        self.assertGreater(result['total'], 0)
        self.assertTrue(all(s['metadata']['kind'] == 'paper' for s in result['results']))
        self.assertTrue(result['results'][0]['source']['uri'].startswith('/workspace.html#literature/read/'))
        self.assertEqual(result['results'][0]['source']['page'], 1)
        named = bridge_retrieve(self.rag, {**payload, 'knowledge_base_ids': ['课题组文献原文']})
        self.assertEqual([s['id'] for s in named['results']], [s['id'] for s in result['results']])
        filtered = bridge_retrieve(self.rag, {**payload, 'filters': {'document_ids': ['not-present']}})
        self.assertEqual(filtered['results'], [])
        notes = bridge_retrieve(self.rag, {**payload, 'query': '投入产出系数', 'knowledge_base_ids': ['chainlab-methods']})
        self.assertTrue(notes['results'])
        self.assertTrue(all(s['metadata']['kind'] == 'curated' for s in notes['results']))

    def test_toolbench_rejects_invalid_or_unsupported_options(self):
        base = {'query': '投入产出', 'knowledge_base_ids': ['chainlab-literature']}
        for extra in ({'knowledge_base_ids': ['other']}, {'top_k': 0}, {'top_k': True},
                      {'score_threshold': float('nan')}, {'options': {'search_mode': 'semantic'}},
                      {'filters': {'metadata': {'author': 'someone'}}}, {'query': ' '}):
            with self.assertRaises(ValueError):
                bridge_retrieve(self.rag, {**base, **extra})

    def test_toolbench_bridge_requires_scoped_service_token(self):
        handler = Mock(client_address=('127.0.0.1', 1000), headers={}, command='GET',
                       path='/api/internal/toolbench-kb/catalog')
        with patch.dict('os.environ', {'CHAINLAB_KB_BRIDGE_TOKEN': 'test-service-token'}):
            bridge_handle(handler)
        self.assertEqual(handler.json_response.call_args.args[0], 403)
        handler.headers = {'Authorization': 'Bearer test-service-token'}
        handler.client_address = ('203.0.113.1', 1000)
        with patch.dict('os.environ', {'CHAINLAB_KB_BRIDGE_TOKEN': 'test-service-token'}):
            bridge_handle(handler)
        self.assertEqual(handler.json_response.call_args.args[0], 403)

    def test_stale_deleted_and_modified_pdf_excluded(self):
        original = self.rag.version()
        doc = self.documents[0]
        with closing(self.store.connect()) as db:
            changed = {**doc, 'pdf': 'f'*64}
            db.execute('UPDATE documents SET metadata=? WHERE id=?', (json.dumps(changed), doc['id']))
            db.execute('DELETE FROM documents WHERE id=?', (self.documents[2]['id'],))
            db.commit()
        self.assertNotEqual(original, self.rag.version())
        with self.assertRaises(LibraryError): self.rag.retrieve('级联', expected=original)
        result = self.rag.retrieve('级联')
        self.assertEqual(result['documents'], 1)
        self.assertNotIn(doc['id'], [s['document_id'] for s in result['sources']])

    def test_citations_reject_fabricated_ids(self):
        result = self.rag.retrieve('阈值')
        self.assertTrue(citations({'evidence_ids': [result['sources'][0]['id']]}, result))
        for ids in (['invented'], 'bad', [None]):
            with self.assertRaises(ValueError): citations({'evidence_ids': ids}, result)

    def test_tutor_retrieval_before_completion_and_cache_invalidation(self):
        calls = []
        def complete(system, payload, tokens):
            calls.append(payload)
            return {'answer': '说明', 'intuition': '列产出', 'example': '合成教学', 'check': '使用方',
                    'steps': ['步骤'], 'pitfalls': ['非因果'], 'evidence_ids': [payload['retrieval']['sources'][0]['id']]}, {}
        tutor = MethodTutor(self.temp.name, complete, rag=self.rag)
        data = {'method_id': 'direct', 'question': '投入产出系数分母是什么'}
        def done(job):
            for _ in range(500):
                job = tutor.job('u', job['id'])
                if job['status'] != 'running': return job
                time.sleep(.01)
            self.fail('timeout')
        try:
            job = done(tutor.start('u', data))
            self.assertEqual(job['status'], 'ready', job)
            self.assertTrue(calls[0]['retrieval']['sources'])
            self.assertEqual(tutor.start('u', data)['id'], job['id'])
            self.ai.save_paper(self.documents[0], 'failed')
            updated = done(tutor.start('u', data))
            self.assertEqual(updated['status'], 'ready')
            self.assertNotEqual(updated['id'], job['id'])
            self.assertEqual(len(calls), 2)
        finally:
            tutor.pool.shutdown(wait=True)

    def test_tutor_retries_invalid_evidence_and_drops_previous_sources(self):
        calls = []
        def complete(system, payload, tokens):
            calls.append(payload)
            return {'answer': '说明', 'intuition': '列产出', 'example': '合成教学', 'check': '使用方',
                    'steps': ['步骤'], 'pitfalls': ['非因果'],
                    'evidence_ids': ['Pold'] if len(calls) == 1 else [payload['retrieval']['sources'][0]['id']]}, {}
        tutor = MethodTutor(self.temp.name, complete, rag=self.rag)
        data = {'method_id': 'direct', 'question': '投入产出系数', 'history': [
            {'role': 'user', 'content': '之前的问题'},
            {'role': 'assistant', 'content': json.dumps({'answer': '之前的回答', 'retrieval': {'sources': ['Pold']}})}]}
        try:
            job = tutor.start('u', data)
            for _ in range(500):
                job = tutor.job('u', job['id'])
                if job['status'] != 'running': break
                time.sleep(.01)
            self.assertEqual(job['status'], 'ready', job)
            self.assertEqual(len(calls), 2)
            self.assertNotIn('retrieval', calls[0]['history'][1]['content'])
        finally:
            tutor.pool.shutdown(wait=True)


if __name__ == '__main__': unittest.main()
