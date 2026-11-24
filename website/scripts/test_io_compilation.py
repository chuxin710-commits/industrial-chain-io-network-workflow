"""Contract, numerical and authentication regressions for the first compiler."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import io_compilation as compiler
from app import Handler
from library import LibraryError, LibraryStore


def sample(**overrides):
    return dict({
        'region': 'Synthetic', 'base_year': 2022, 'year': 2023,
        'classification': 'test v1', 'valuation': 'current', 'price_basis': 'test basis',
        'unit': 'units', 'source': 'v0.4 7.1 synthetic',
        'usage_authorized': True, 'scope_aligned': True, 'estimation_allowed': True,
        'sectors': ['P01', 'P02'], 'final_uses': ['Y'], 'value_added': ['VA'],
        'z0': [[10, 10], [10, 10]], 'x': [120, 80], 'm': [10, 5],
        'y': [[98], [53]], 'va': [[84, 52]],
    }, **overrides)


class CompilationTests(unittest.TestCase):
    def run_estimate(self, data):
        preflight = compiler.preflight(data)[0]
        return compiler.run(data, preflight['snapshot_hash'], True)

    def test_example_and_determinism(self):
        report = self.run_estimate(sample())
        self.assertEqual(report['preflight']['row_targets'], [32, 32])
        self.assertEqual(report['preflight']['column_targets'], [36, 28])
        self.assertEqual(report['table']['z'], [[18, 14], [18, 14]])
        self.assertEqual(report['verification']['absolute_adjustment'], 24)
        self.assertEqual(report['verification']['independent_validation'], 'not_performed')
        self.assertEqual(report, self.run_estimate(report['input']))

    def test_support_conflict_with_equal_totals_and_nonempty_axes(self):
        check = compiler.preflight(sample(z0=[[10, 0], [0, 10]]))[0]
        self.assertEqual(check['status'], 'blocked')
        self.assertEqual(check['blocking']['code'], 'structural_support')
        self.assertEqual(check['blocking']['unallocated'], 4)
        self.assertTrue(check['blocking']['rows'])

    def test_other_blockers(self):
        for data, code in [
            (sample(usage_authorized=False), 'confirmation'),
            (sample(y=[[131], [53]]), 'negative_targets'),
            (sample(va=[[84, 53]]), 'margin_totals'),
            (sample(z0=[[0, 0], [1, 3]]), 'empty_support'),
        ]:
            with self.subTest(code=code):
                self.assertEqual(compiler.preflight(data)[0]['blocking']['code'], code)
                with self.assertRaises(LibraryError) as exc:
                    self.run_estimate(data)
                self.assertEqual(exc.exception.status, 422)

    def test_zero_and_signed_fixed_blocks(self):
        report = self.run_estimate(sample(y=[[130], [53]], va=[[120, 48]], z0=[[1, 1], [0, 1]]))
        self.assertEqual(report['table']['z'], [[0, 0], [0, 32]])
        report = self.run_estimate(sample(final_uses=['consumption', 'inventory'], y=[[99, -1], [53, 0]]))
        self.assertEqual(report['table']['z'], [[18, 14], [18, 14]])
        self.assertEqual(report['table']['y'][0][1], -1)

    def test_invalid_and_changed_snapshot(self):
        for data in [sample(x=[True, 80]), sample(z0=[[float('nan')]]), sample(m=[0]),
                     sample(sectors=['same', 'same']), sample(valuation='constant'),
                     sample(price_basis='\ud800'), sample(locks=[]), sample(z0=[[-1, 0], [1, 2]])]:
            with self.assertRaises(LibraryError):
                compiler.preflight(data)
        digest = compiler.preflight(sample())[0]['snapshot_hash']
        for data, confirmed in [(sample(source='changed'), True), (sample(), False), (sample(), 1)]:
            with self.assertRaises(LibraryError) as exc:
                compiler.run(data, digest, confirmed)
            self.assertEqual(exc.exception.status, 409)

    def test_not_converged_no_partial_table(self):
        with patch.object(compiler, 'MAX_ITER', 1):
            with self.assertRaises(LibraryError) as exc:
                self.run_estimate(sample(z0=[[10, 1], [2, 10]]))
            self.assertEqual(exc.exception.data['state'], 'not_converged')
            self.assertNotIn('table', exc.exception.data)

    def test_session_csrf_and_success(self):
        with tempfile.TemporaryDirectory() as folder, ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            server.library = LibraryStore(folder)
            server.library.provision_shared_account('compiler-test', 'synthetic-password')
            token = server.library.login('compiler-test', 'synthetic-password', 'test')
            csrf = server.library.auth(token)['csrf']
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}/api/library/io-compilation'

            def post(action, body, session=False, include_csrf=False):
                headers = {'Content-Type': 'application/json'}
                if session:
                    headers['Cookie'] = 'chainlab_session=' + token
                if include_csrf:
                    headers['X-CSRF-Token'] = csrf
                request = Request(base + '/' + action, data=json.dumps(body).encode(), headers=headers)
                try:
                    with urlopen(request, timeout=5) as reply:
                        return reply.status, json.load(reply)
                except HTTPError as error:
                    return error.code, json.load(error)

            try:
                body = {'input': sample()}
                self.assertEqual(post('preflight', body)[0], 401)
                self.assertEqual(post('preflight', body, True)[0], 403)
                code, check = post('preflight', body, True, True)
                self.assertEqual(code, 200)
                self.assertEqual(post('run', {**body, 'snapshot_hash': check['snapshot_hash'], 'confirmed': True}, True, True)[1]['table']['z'], [[18, 14], [18, 14]])
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
