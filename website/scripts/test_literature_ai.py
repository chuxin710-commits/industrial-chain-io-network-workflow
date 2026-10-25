"""Synthetic tests: no live provider, no private corpus or credential required."""
from contextlib import closing
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from library import LibraryStore, LibraryError
from literature_ai import LiteratureAI, REVIEW_VERSION, texts, prose, complete


class LiteratureAITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.library = LibraryStore(self.root)
        self.document = {'id': 'a' * 32, 'title': 'Synthetic network research', 'authors': [], 'year': 2023, 'pages': 1}
        import pymupdf
        pdf = pymupdf.open()
        page = pdf.new_page()
        self.quote = 'Input output networks represent transactions from suppliers to users.'
        page.insert_textbox((30, 30, 550, 800), (self.quote + '\n') * 12)
        content = pdf.tobytes(); pdf.close()
        sha = hashlib.sha256(content).hexdigest()
        self.document['pdf'] = sha
        (self.root / 'pdfs').mkdir()
        (self.root / 'pdfs' / f'{sha}.pdf').write_bytes(content)
        with closing(self.library.connect()) as db, db:
            db.execute('INSERT INTO documents VALUES(?,?)', (self.document['id'], json.dumps(self.document)))
        self.calls = 0
        def completion(system, payload, max_tokens):
            self.calls += 1
            return {'summary': 'Synthetic summary: this paper represents transactions as directed supplier to user networks.',
                    'tags': ['投入产出', '复杂网络'], 'themes': ['network', 'invented'], 'methods': ['directed graph'],
                    'evidence': [{'page': 1, 'quote': self.quote}, {'page': 2, 'quote': self.quote}, {'page': 1, 'quote': 'An invented quotation not in this PDF.'}]}, {'total_tokens': 100}
        self.ai = LiteratureAI(self.library, completion)

    def tearDown(self):
        self.temp.cleanup()

    def test_summary_caches_and_keeps_only_verbatim_evidence(self):
        self.assertEqual(self.ai.summarize(self.document), 'ready')
        self.assertEqual(self.ai.summarize(self.document), 'cached')
        self.assertEqual(self.calls, 1)
        data = self.ai.catalog()
        self.assertEqual(data['ai_status']['ready'], 1)
        result = data['documents'][0]['ai']
        self.assertEqual(result['themes'], ['network'])
        self.assertEqual(result['evidence'], [{'page': 1, 'quote': self.quote}])
        self.assertEqual(result['coverage']['total_pages'], 1)

    def test_changed_pdf_invalidates_summary(self):
        self.ai.summarize(self.document)
        with closing(self.library.connect()) as db, db:
            db.execute('UPDATE documents SET metadata=?', (json.dumps({**self.document, 'pdf': 'b' * 64}),))
        self.assertEqual(self.ai.catalog()['documents'][0]['ai']['status'], 'pending')

    def test_failure_does_not_publish_summary_or_secret(self):
        def fail(*args):
            raise RuntimeError('sensitive provider body must not be persisted')
        self.ai.completion = fail
        self.assertEqual(self.ai.summarize(self.document), 'failed')
        result = self.ai.catalog()['documents'][0]['ai']
        self.assertNotIn('summary', result)
        self.assertNotIn('sensitive', result['error'])

    def test_theme_validation(self):
        for theme in [None, [], {}, 'unknown']:
            with self.assertRaises(LibraryError) as caught:
                self.ai.start(theme)
            self.assertEqual(caught.exception.status, 400)

    def test_provider_prose_variants_preserve_content(self):
        self.assertEqual(texts('Same sector ordering required'), ['Same sector ordering required'])
        self.assertEqual(prose(['First result', 'Second result']), 'First result\nSecond result')
        value = self.framework()
        value['stages'][0]['options'][0]['requires'] = 'Same sector ordering required'
        result = self.ai.validate_framework(value, [{'id': self.document['id'], 'pages': [{'page': 1}]}])
        self.assertEqual(result['stages'][0]['options'][0]['requires'], ['Same sector ordering required'])

    def test_json_repair_is_bounded_and_counts_usage(self):
        def response(content):
            return io.BytesIO(json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': content}}],
                                          'usage': {'total_tokens': 10}}).encode())
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'synthetic-key'}), patch('literature_ai.urlopen', side_effect=[response('not JSON'), response('{"valid":true}')]) as request:
            value, usage = complete('Synthetic prompt', {}, 100)
            self.assertTrue(value['valid'])
            self.assertEqual(usage['total_tokens'], 20)
            self.assertEqual(request.call_count, 2)
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'synthetic-key'}), patch('literature_ai.urlopen', side_effect=[response('bad'), response('bad')]) as request:
            with self.assertRaises(LibraryError): complete('Synthetic prompt', {}, 100)
            self.assertEqual(request.call_count, 2)

    def framework(self):
        option = {'title': 'Build graph', 'basis': 'literature', 'theory': 'Directed input output graph',
                  'data': 'Transaction matrix', 'validation': 'Check row and column sums', 'steps': ['Check totals'],
                  'requires': ['Use the same sector order'], 'citations': [{'document_id': self.document['id'], 'page': 1}]}
        return {'title': 'Synthetic framework', 'question': 'Synthetic question',
                'stages': [{'title': str(i), 'options': [copy.deepcopy(option), copy.deepcopy(option)]} for i in range(4)],
                'cautions': ['Not an empirical result']}

    def test_review_provider_model_and_thinking_are_explicit(self):
        response = io.BytesIO(json.dumps({'choices': [{'finish_reason': 'stop', 'message': {
            'content': '{"valid":true}', 'reasoning_content': 'Private provider reasoning'}}],
            'usage': {'total_tokens': 20}}).encode())
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'synthetic-key'}), patch('literature_ai.urlopen', return_value=response) as request:
            value, usage = complete('Synthetic review', {}, 22000, model='deepseek-v4-pro', thinking=True)
            body = json.loads(request.call_args.args[0].data)
            self.assertEqual(body['model'], 'deepseek-v4-pro')
            self.assertEqual(body['thinking'], {'type': 'enabled'})
            self.assertEqual(request.call_args.kwargs['timeout'], 300)
            self.assertEqual(value, {'valid': True})
            self.assertEqual(usage['total_tokens'], 20)

    def test_framework_rejects_unprovided_citation_page(self):
        sources = [{'id': self.document['id'], 'pages': [{'page': 1}]}]
        result = self.ai.validate_framework(self.framework(), sources)
        self.assertEqual(len(result['stages']), 4)
        bad = self.framework()
        bad['stages'][0]['options'][0]['citations'][0]['page'] = 99
        with self.assertRaises(ValueError):
            self.ai.validate_framework(bad, sources)

    def test_abandoned_job_expires_instead_of_polling_forever(self):
        identifier = 'f' * 32
        with closing(self.ai.connect()) as db, db:
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)',
                       (identifier, 'old-key', 'network', 'running', 'matching', '{}', '', time.time() - 901))
        self.assertEqual(self.ai.job(identifier)['status'], 'failed')

    def test_framework_job_matches_reads_and_reuses_cache(self):
        self.ai.summarize(self.document)
        def completion(system, payload, max_tokens):
            if 'catalog' in payload:
                return {'matches': [{'id': self.document['id'], 'reason': 'Synthetic match'}, {'id': 'invented', 'reason': ''}], 'focus': 'Synthetic'}, {}
            self.assertIn(self.quote, payload['sources'][0]['pages'][0]['text'])
            if 'draft' in payload:
                fields = {k: v for k, v in payload['draft']['stages'][0]['options'][0].items() if k != 'id'}
                fields['validation'] = 'Check spectral radius'
                return {'corrections': [{'stage': 0, 'option': 0, 'fields': fields}],
                        'top_level': {k: payload['draft'][k] for k in ('title', 'question', 'cautions')},
                        'review_notes': ['Synthetic method review']}, {}
            return self.framework(), {}
        self.ai.completion = completion
        job = self.ai.start('network')
        deadline = time.monotonic() + 3
        while self.ai.job(job['id'])['status'] == 'running' and time.monotonic() < deadline:
            time.sleep(0.02)
        finished = self.ai.job(job['id'])
        self.assertEqual(finished['status'], 'ready', finished['error'])
        self.assertEqual(finished['result']['review_version'], REVIEW_VERSION)
        self.assertEqual(finished['result']['stages'][0]['options'][0]['validation'], 'Check spectral radius')
        self.assertEqual(len(finished['result']['sources']), 1)
        self.assertEqual(self.ai.start('network')['id'], job['id'])

    def test_review_rejects_partial_patch_that_can_leave_stale_steps(self):
        self.ai.completion = lambda *args: ({
            'corrections': [{'stage': 0, 'option': 0, 'fields': {'formula': 'Corrected formula'}}],
            'top_level': {k: self.framework()[k] for k in ('title', 'question', 'cautions')},
            'review_notes': []}, {})
        with self.assertRaisesRegex(ValueError, 'complete option'):
            self.ai.review(self.framework(), [{'id': self.document['id'], 'pages': [{'page': 1}]}], 'review-test')


if __name__ == '__main__':
    unittest.main()
