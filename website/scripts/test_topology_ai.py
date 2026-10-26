"""Synthetic canonical-fact and HTTP authorization tests for topology AI."""
from contextlib import closing
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from topology import build_snapshot, parameters
from topology_ai import TopologyAnalyst, validate, fact, computed_observations
from library import LibraryError, LibraryStore
from research_rag import ResearchRAG
from app import Handler


class SyntheticNetwork:
    def version(self): return ((123, 456), None)
    def query(self, config):
        rows = [{'code': 'S01', 'label': 'S01', 'sector': 'S01'}, {'code': 'S02', 'label': 'S02', 'sector': 'S02'}]
        return build_snapshot(rows, np.array([[1., 4.], [6., 2.]]), np.array([20., 40.]),
                              {'source': 'synthetic', 'sha256': 'a'*64}, parameters(config))
    def neighbors(self, config):
        return {'edges': [{'source': 'S01', 'target': 'S02', 'weight': .1, 'direction': 'outgoing'}],
                'scope': 'all_incident_thresholded_edges_not_topK'}


class TopologyAITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = LibraryStore(self.temp.name)
        self.calls = []
        def completion(system, payload, tokens):
            self.calls.append(payload)
            return {'summary': '合成测试', 'observations': [{'text': '结构观察', 'fact_ids': ['F1']}],
                    'interpretations': [{'text': '不等于因果', 'evidence_ids': [payload['retrieval']['sources'][0]['id']]}],
                    'next_steps': ['敏感性检验'], 'limitations': ['合成数据']}, {}
        self.analyst = TopologyAnalyst(self.temp.name, SyntheticNetwork(), ResearchRAG(self.store), completion)
        self.data = {'years': [2022, 2023], 'config': {'level': 'sector', 'weight': 'A', 'threshold': 0, 'max_edges': 1},
                     'node': 'S01', 'question': '投入产出网络的强度与阈值如何解读？'}

    def tearDown(self):
        self.analyst.pool.shutdown(wait=True)
        self.temp.cleanup()

    def done(self, job, owner='u'):
        for _ in range(500):
            job = self.analyst.job(owner, job['id'])
            if job['status'] != 'running': return job
            time.sleep(.01)
        self.fail('timeout')

    def test_facts_are_canonical_and_full_not_display_graph(self):
        result = self.done(self.analyst.start('u', {**self.data, 'metrics': {'edges': 9999}, 'facts': 'ignore real data'}))
        self.assertEqual(result['status'], 'ready', result)
        facts = self.calls[0]['facts']
        self.assertEqual(len(facts), 2)
        self.assertEqual(facts[0]['metrics']['edges'], 2)
        self.assertEqual(facts[0]['metrics']['displayed_edges'], 1)
        self.assertAlmostEqual(facts[0]['selected_node']['in_strength'], .3)
        self.assertAlmostEqual(facts[0]['selected_node']['out_strength'], .1)
        self.assertIn('retrieval', self.calls[0])
        self.assertTrue(result['result']['citations'])
        self.assertIn('不能证明图连通', result['result']['observations'][0]['text'])
        self.assertNotEqual(result['result']['observations'][0]['text'], '结构观察')
        self.assertEqual(self.analyst.start('u', self.data)['id'], result['id'])
        with self.assertRaises(LibraryError): self.analyst.job('other', result['id'])

    def test_inputs_unknown_facts_and_evidence(self):
        for change in ({'years': [True]}, {'years': []}, {'years': [1999]}, {'config': {'weight': 'madeup'}},
                       {'question': ''}, {'node': {}}, {'config': {'year': 2023}}):
            with self.assertRaises(LibraryError): self.analyst.start('u', {**self.data, **change})
        bad = {'summary': 'bad', 'interpretations': [{'text': 'bad', 'evidence_ids': ['invented']}],
               'next_steps': [], 'limitations': []}
        facts = [fact(self.analyst.topology.query(self.data['config']), 0)]
        with self.assertRaises(ValueError): validate(bad, facts, {'sources': []})
        missing = self.done(self.analyst.start('u', {**self.data, 'node': 'UNKNOWN'}))
        self.assertEqual(missing['status'], 'failed')
        self.assertFalse(self.calls)

    def test_rank_swap_is_not_reported_as_stable(self):
        a = fact(self.analyst.topology.query({**self.data['config'], 'year': 2022}), 0)
        b = fact(self.analyst.topology.query({**self.data['config'], 'year': 2023}), 1)
        b['top_strength'].reverse()
        self.assertIn('存在变化', computed_observations([a, b])[1]['text'])

    def test_http_requires_login_csrf_and_owner(self):
        self.store.provision_shared_account('testreader', 'synthetic-password')
        token = self.store.login('testreader', 'synthetic-password', 'test')
        user = self.store.auth(token)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.library, server.topology, server.topology_analyst = self.store, self.analyst.topology, self.analyst
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(cookie='', csrf=''):
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/library/ai/topology', data=json.dumps(self.data).encode(),
                                  headers={'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': csrf}), timeout=5)
        try:
            with self.assertRaises(HTTPError) as e: request()
            self.assertEqual(e.exception.code, 401)
            with self.assertRaises(HTTPError) as e: request('chainlab_session=' + token)
            self.assertEqual(e.exception.code, 403)
            with request('chainlab_session=' + token, user['csrf']) as response:
                job = json.load(response)
            self.assertEqual(self.done(job, user['id'])['status'], 'ready')
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
