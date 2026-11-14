"""SkillHub persistence, isolation, validation and HTTP boundary regression."""
from contextlib import closing
from http.server import ThreadingHTTPServer
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from library import LibraryStore, LibraryError
from skillhub import SkillHub, parse_skill
from app import Handler

CONTENT = '---\nname: test-skill\ndescription: |\n  Test research skill.\n---\n\n# Checklist\n\n<script>alert(1)</script>\n'


class SkillTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LibraryStore(self.tmp.name)
        with closing(self.store.connect()) as db, db:
            for owner in ('a', 'b'):
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?)', (owner, owner, owner, '', 'member', 0, 0))
            self.token = self.store.session(db, 'a')
        self.user = self.store.auth(self.token)
        self.hub = SkillHub(self.store)

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        return self.hub.save(self.user, {'filename': 'skill.md', 'content': CONTENT})

    def error(self, status, fn):
        with self.assertRaises(LibraryError) as caught:
            fn()
        self.assertEqual(caught.exception.status, status)

    def test_yaml_and_digest(self):
        parsed = parse_skill('\ufeff' + CONTENT.replace('\n', '\r\n'))
        self.assertEqual(parsed['summary'], 'Test research skill.')
        self.assertEqual(parsed['sha256'], hashlib.sha256(CONTENT.encode()).hexdigest())

    def test_reject_invalid_files(self):
        for content in ('', '# No frontmatter', CONTENT.replace('test-skill', '../escape'), CONTENT.replace('test-skill', 'UPPER'), CONTENT.replace('Test research skill.', '\x00'), 'x' * 40001, CONTENT.replace('description: |\n  Test research skill.', 'description: [bad]'), CONTENT.replace('description: |\n  Test research skill.', 'description: !!python/object:evil {}')):
            with self.assertRaises(LibraryError):
                parse_skill(content)
        self.error(400, lambda: parse_skill(CONTENT, '../SKILL.md'))

    def test_persist_isolate_duplicate_delete(self):
        item = self.save()
        reloaded = SkillHub(LibraryStore(self.tmp.name))
        self.assertEqual(reloaded.get(item['id'], self.user)['content'], CONTENT)
        self.assertNotIn('owner', reloaded.get(item['id'], self.user))
        self.error(404, lambda: self.hub.get(item['id'], {'id': 'b'}))
        self.error(404, lambda: self.hub.get(item['id'], None))
        self.error(409, self.save)
        self.hub.favorite(self.user, item['id'], True)
        self.assertTrue(next(i for i in self.hub.listing(self.user)['items'] if i['id'] == item['id'])['favorite'])
        self.hub.delete(self.user, item['id'])
        self.error(404, lambda: self.hub.get(item['id'], self.user))

    def test_curated_sources_hashes_and_summary_payload(self):
        public = self.hub.listing(None)['items']
        self.assertGreaterEqual(len(public), 10)
        for item in public:
            self.assertNotIn('content', item)
            self.assertNotIn('license_text', item)
            self.assertGreater(item['stars'], 1000)
            source = self.hub.get(item['id'], None)
            self.assertEqual(source['sha256'], hashlib.sha256(source['content'].encode()).hexdigest())
            self.assertGreater(len(source['license_text']), 100)
            self.assertIn(source['commit'], source['source'])
        self.error(403, lambda: self.hub.delete(self.user, public[0]['id']))

    def test_favorites_private_and_idempotent(self):
        identifier = self.hub.catalog['items'][0]['id']
        for _ in range(2): self.hub.favorite(self.user, identifier, True)
        self.assertTrue(self.hub.listing(self.user)['items'][0]['favorite'])
        self.assertFalse(self.hub.listing({'id': 'b'})['items'][0]['favorite'])
        self.hub.favorite(self.user, identifier, False)
        self.assertFalse(self.hub.listing(self.user)['items'][0]['favorite'])
        self.error(400, lambda: self.hub.favorite(self.user, identifier, 'true'))

    def test_http_auth_csrf_origin_download(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.library = self.store
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}/api/library/skills'

        def request(path='', method='GET', body=None, auth=True, csrf=True, origin=None):
            headers = {'Content-Type': 'application/json'}
            if auth: headers['Cookie'] = 'chainlab_session=' + self.token
            if csrf: headers['X-CSRF-Token'] = self.user['csrf']
            if origin: headers['Origin'] = origin
            try:
                with urlopen(Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)) as r:
                    return r.status, dict(r.headers), r.read()
            except HTTPError as e:
                return e.code, dict(e.headers), e.read()
        try:
            payload = {'filename': 'SKILL.md', 'content': CONTENT}
            self.assertEqual(request(auth=False)[0], 200)
            self.assertEqual(request(method='POST', body=payload, auth=False)[0], 401)
            self.assertEqual(request(method='POST', body=payload, csrf=False)[0], 403)
            self.assertEqual(request(method='POST', body=payload, origin='https://evil.invalid')[0], 403)
            status, _, body = request(method='POST', body=payload)
            self.assertEqual(status, 201)
            identifier = json.loads(body)['id']
            status, headers, content = request('/' + identifier + '/download')
            self.assertEqual(status, 200)
            self.assertEqual(content.decode(), CONTENT)
            self.assertIn('attachment', headers['Content-Disposition'])
            self.assertEqual(request('/' + identifier + '/download', auth=False)[0], 404)
            self.assertEqual(request('/' + identifier, method='DELETE', body={})[0], 200)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
