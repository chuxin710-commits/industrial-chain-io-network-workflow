"""Synthetic isolation, synchronization and attachment tests for the private library."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from library import LibraryStore, LibraryError, password_matches
from app import Handler

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.store=LibraryStore(self.root);self.doc='a'*32;self.sha='b'*64
        with closing(self.store.connect()) as db,db:
            db.execute('INSERT INTO documents VALUES(?,?)',(self.doc,json.dumps({'title':'Synthetic paper','authors':[],'year':2023,'pdf':self.sha,'pages':2})))
        (self.root/'pdfs').mkdir();(self.root/'pdfs'/f'{self.sha}.pdf').write_bytes(b'%PDF-1.7\nsynthetic-range-test')
        self.store.provision_shared_account('shared','synthetic-password')
        self.token=self.store.login('shared','synthetic-password','test');self.user=self.store.auth(self.token)
    def tearDown(self):self.tmp.cleanup()
    def note(self,**kw):return {'document_id':self.doc,'kind':'note','page':1,'body':'shared note','byline':'Reader A',**kw}
    def error(self,status,callback):
        with self.assertRaises(LibraryError) as c:callback()
        self.assertEqual(c.exception.status,status)
        return c.exception
    def test_one_enabled_account_no_registration_and_hashed_secret(self):
        self.store.provision_shared_account('only','replacement-password')
        self.assertIsNone(self.store.auth(self.token))
        self.assertEqual([m['username'] for m in self.store.members() if not m['disabled']],['only'])
        self.error(403,lambda:self.store.register({}))
        self.error(403,lambda:self.store.create_invitation())
        with closing(self.store.connect()) as db:
            value=db.execute("SELECT password FROM users WHERE username='only'").fetchone()[0]
        self.assertNotIn('replacement-password',value);self.assertTrue(password_matches('replacement-password',value))
    def test_shared_sessions_see_same_records_and_self_reported_byline(self):
        other=self.store.auth(self.store.login('shared','synthetic-password','other'))
        created=self.store.save_annotation(self.user,self.note())
        self.assertIn('自填署名',created['author'])
        edited=self.store.save_annotation(other,self.note(body='updated',version=created['version'],byline='Reader B'),created['id'])
        self.assertEqual(edited['byline'],'Reader A');self.assertEqual(edited['last_editor'],'Reader B')
        self.assertEqual(self.store.annotations(self.doc)['annotations'][0]['body'],'updated')
    def test_simultaneous_edit_exactly_one_wins(self):
        created=self.store.save_annotation(self.user,self.note())
        def edit(n):
            try:return self.store.save_annotation(self.user,self.note(body=str(n),version=1),created['id'])['version']
            except LibraryError as e:return e.status
        with ThreadPoolExecutor(2) as executor:result=list(executor.map(edit,[1,2]))
        self.assertEqual(sorted(result),[2,409])
    def test_delete_is_versioned_soft_delete_with_history(self):
        mark=self.store.save_annotation(self.user,self.note())
        self.error(409,lambda:self.store.save_annotation(self.user,self.note(version=0),mark['id'],delete=True))
        removed=self.store.save_annotation(self.user,self.note(version=1,byline='Reader B'),mark['id'],delete=True)
        self.assertEqual(removed['deleted'],1);self.assertEqual(removed['last_editor'],'Reader B')
        self.assertEqual(self.store.annotations(self.doc)['annotations'],[])
        with closing(self.store.connect()) as db:self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0],2)
    def test_normalized_coordinates_all_mark_types_and_page_limits(self):
        for kind,anchor in [('highlight',{'rects':[[.1,.2,.3,.4]]}),('area',{'rects':[[0,0,1,1]]}),('ink',{'points':[[0,0],[1,1]]}),('bookmark',{})]:
            self.assertEqual(self.store.save_annotation(self.user,self.note(kind=kind,anchor=anchor))['anchor'],anchor)
        for data in [self.note(page=3),self.note(page=True),self.note(kind='area',anchor={'rects':[[0,0,2,1]]}),self.note(kind='ink',anchor={'points':[[0,0]]}),self.note(body=''),self.note(byline='a'*41)]:
            self.error(400,lambda:self.store.save_annotation(self.user,data))
    def test_original_marks_are_readonly(self):
        mark=self.store.save_annotation(self.user,self.note())
        with closing(self.store.connect()) as db,db:db.execute("UPDATE annotations SET origin='pdf' WHERE id=?",(mark['id'],))
        self.error(403,lambda:self.store.save_annotation(self.user,self.note(version=1),mark['id']))
    def test_http_private_pdf_ranges_csrf_and_conditional_sync(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.library=self.store
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        base=f'http://127.0.0.1:{server.server_port}/api/library'
        def request(path,method='GET',body=None,auth=True,**headers):
            if auth:headers['Cookie']='chainlab_session='+self.token
            if body is not None:headers['Content-Type']='application/json'
            req=Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers=headers)
            try:
                with urlopen(req) as r:return r.status,dict(r.headers),r.read()
            except HTTPError as e:return e.code,dict(e.headers),e.read()
        try:
            self.assertEqual(request('/ai/status',auth=False)[0],401)
            self.assertEqual(request('/ai/framework','POST',{'theme':'network'})[0],403)
            self.assertEqual(request('/ai/status')[0],200)
            self.assertEqual(request('/ai/framework','POST',{'theme':[]},**{'X-CSRF-Token':self.user['csrf']})[0],400)
            file=f'/documents/{self.doc}/pdf'
            self.assertEqual(request(file,auth=False)[0],401)
            status,h,body=request(file,Range='bytes=0-7');self.assertEqual((status,body),(206,b'%PDF-1.7'))
            self.assertEqual(h['Content-Range'],'bytes 0-7/29')
            self.assertEqual(request(file,Range='bytes=999-')[0],416)
            self.assertEqual(request('/annotations','POST',self.note())[0],403)
            self.assertEqual(request('/annotations','POST',self.note(),**{'X-CSRF-Token':self.user['csrf']})[0],201)
            status,h,_=request('/annotations?document_id='+self.doc)
            self.assertEqual(status,200)
            self.assertEqual(request('/annotations?document_id='+self.doc,**{'If-None-Match':h['ETag']})[0],304)
            self.store.logout(self.token);self.assertEqual(request(file)[0],401)
        finally:server.shutdown();server.server_close();t.join()

if __name__=='__main__':unittest.main()
