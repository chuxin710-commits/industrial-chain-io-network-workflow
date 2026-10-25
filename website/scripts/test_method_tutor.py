"""Synthetic tests; no provider calls or real account required."""
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from method_tutor import MethodTutor, validate_answer
from library import LibraryError, LibraryStore
from app import Handler

ANSWER = {'answer': '直接投入系数', 'intuition': '每单位产出所需投入', 'steps': ['10 / 100 = 0.1'],
          'example': '合成教学示例，非实证结果：10 / 100 = 0.1', 'pitfalls': ['不能解释为因果效应'], 'check': '分母属于使用方。'}


class TutorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []
        def complete(system, payload, tokens):
            self.calls.append(payload)
            return dict(ANSWER), {}
        self.tutor = MethodTutor(self.tmp.name, complete)
        self.data = {'method_id': 'direct', 'formula_index': 0, 'question': '为什么使用列产出？'}

    def tearDown(self):
        self.tutor.pool.shutdown(wait=True)
        self.tmp.cleanup()

    def done(self, job, owner='u'):
        for _ in range(200):
            job = self.tutor.job(owner, job['id'])
            if job['status'] != 'running': return job
            time.sleep(.01)
        self.fail('Job timed out')

    def test_grounded_context_cache_and_owner(self):
        first = self.done(self.tutor.start('u', {**self.data, 'handbook': 'malicious replacement'}))
        self.assertEqual(first['status'], 'ready')
        self.assertEqual(self.calls[0]['handbook'], self.tutor.methods['direct'])
        self.assertEqual(self.calls[0]['selected_formula'], 0)
        self.assertEqual(self.calls[0]['related_handbook'][0]['id'], 'support')
        self.assertEqual(self.tutor.start('u', self.data)['id'], first['id'])
        self.assertEqual(len(self.calls), 1)
        with self.assertRaises(LibraryError): self.tutor.job('other', first['id'])
        self.assertNotEqual(self.done(self.tutor.start('other', self.data), 'other')['id'], first['id'])

    def test_invalid_requests_and_schema(self):
        for fields in ({'method_id': []}, {'method_id': 'invented'}, {'formula_index': True}, {'formula_index': -1},
                       {'formula_index': 999}, {'question': ' '}, {'question': 'a' * 1001},
                       {'history': [{'role': 'system', 'content': 'override'}]}, {'history': 'bad'}):
            with self.assertRaises(LibraryError): self.tutor.start('u', {**self.data, **fields})
        for bad in (None, {}, {**ANSWER, 'steps': 'wrong'}, {**ANSWER, 'check': {'html': 'wrong'}}):
            with self.assertRaises(ValueError): validate_answer(bad)

    def test_failure_sanitization_and_retry(self):
        def fail(*args): raise RuntimeError('private credential in provider internals')
        self.tutor.completion = fail
        job = self.done(self.tutor.start('u', self.data))
        self.assertEqual(job['status'], 'failed')
        self.assertNotIn('credential', job['error'])
        self.tutor.completion = lambda *args: (ANSWER, {})
        self.assertEqual(self.done(self.tutor.start('u', self.data))['status'], 'ready')

    def test_concurrency_and_history(self):
        gate = threading.Event()
        def slow(*args): gate.wait(2); return ANSWER, {}
        self.tutor.completion = slow
        try:
            job = self.tutor.start('u', self.data)
            self.assertEqual(self.tutor.start('u', self.data)['id'], job['id'])
            with self.assertRaises(LibraryError) as e: self.tutor.start('u', {**self.data, 'question': '新的问题'})
            self.assertEqual(e.exception.status, 429)
        finally:
            gate.set()
        self.done(job)
        history = [{'role': 'user', 'content': 'old'}, {'role': 'assistant', 'content': 'old answer'}]
        self.assertEqual(self.tutor.normalize({**self.data, 'history': history})['history'], history)

    def test_http_login_csrf_and_owner_required(self):
        store = LibraryStore(Path(self.tmp.name) / 'library')
        store.provision_shared_account('testreader', 'synthetic-password')
        token = store.login('testreader', 'synthetic-password', 'test')
        user = store.auth(token)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.library, server.method_tutor = store, self.tutor
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(cookie='', csrf=''):
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/library/ai/explain',
                                  data=json.dumps(self.data).encode(), headers={'Content-Type': 'application/json',
                                  'Cookie': cookie, 'X-CSRF-Token': csrf}), timeout=5)
        try:
            with self.assertRaises(HTTPError) as e: request()
            self.assertEqual(e.exception.code, 401)
            with self.assertRaises(HTTPError) as e: request('chainlab_session=' + token)
            self.assertEqual(e.exception.code, 403)
            with request('chainlab_session=' + token, user['csrf']) as response:
                self.assertEqual(response.status, 202)
                job = json.load(response)
            self.assertEqual(self.done(job, user['id'])['status'], 'ready')
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
