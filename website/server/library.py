"""Private team library, authenticated identities and versioned shared annotations."""

from contextlib import closing
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid


class LibraryError(Exception):
    def __init__(self, status, message, **details):
        self.status, self.data = status, {"error": message, **details}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise LibraryError(400, "密码须为 8–128 个字符")
    salt = secrets.token_hex(16)
    value = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()
    return f"pbkdf2_sha256$600000${salt}${value}"


def password_matches(password, stored):
    if not isinstance(password, str) or len(password) > 128:
        return False
    _, rounds, salt, expected = stored.split('$')
    actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds)).hex()
    return hmac.compare_digest(actual, expected)


class LibraryStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / 'library.sqlite3'
        with closing(self.connect()) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS documents(
                  id TEXT PRIMARY KEY, metadata TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users(
                  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
                  password TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
                  created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS invitations(
                  hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires REAL NOT NULL,
                  used_by TEXT, created_by TEXT, created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions(
                  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                  csrf TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attempts(
                  key TEXT NOT NULL, at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS annotations(
                  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
                  author_id TEXT REFERENCES users(id), kind TEXT NOT NULL, page INTEGER,
                  color TEXT NOT NULL, body TEXT NOT NULL, quote TEXT NOT NULL, anchor TEXT NOT NULL,
                  origin TEXT NOT NULL DEFAULT 'team', created REAL NOT NULL, updated REAL NOT NULL,
                  version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS annotations_document ON annotations(document_id,updated);
                CREATE TABLE IF NOT EXISTS events(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL,
                  annotation_id TEXT NOT NULL, actor TEXT, operation TEXT NOT NULL,
                  snapshot TEXT NOT NULL, created REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_document ON events(document_id,id);
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            ''')
            columns={r[1] for r in db.execute('PRAGMA table_info(annotations)')}
            for name in ('byline','last_editor'):
                if name not in columns:db.execute(f"ALTER TABLE annotations ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            db.commit()

    def single_account(self):
        with closing(self.connect()) as db:
            return bool(db.execute("SELECT 1 FROM settings WHERE key='shared_account'").fetchone())

    def provision_shared_account(self,username,password):
        name=username.strip().lower()
        if not re.fullmatch(r'[a-z0-9_.-]{3,32}',name):raise LibraryError(400,'账号格式无效')
        hashed=password_hash(password)
        with closing(self.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            existing=db.execute('SELECT id FROM users WHERE username=?',(name,)).fetchone()
            identifier=existing[0] if existing else uuid.uuid4().hex
            db.execute('''INSERT INTO users(id,username,display_name,password,role,created) VALUES(?,?,?,?,?,?)
              ON CONFLICT(username) DO UPDATE SET password=excluded.password,disabled=0,role='admin' ''',
              (identifier,name,name,hashed,'admin',time.time()))
            db.execute('UPDATE users SET disabled=1 WHERE id<>?',(identifier,))
            db.execute('DELETE FROM sessions')
            db.execute("INSERT INTO settings VALUES('shared_account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(name,))
        return name

    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=10000')
        return db

    def auth(self, token):
        with closing(self.connect()) as db:
            user = db.execute('''SELECT u.id,u.username,u.display_name,u.role,s.csrf FROM sessions s
                 JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.disabled=0''',
                              (digest(token or ''), time.time())).fetchone()
        return dict(user) if user else None

    def require(self, token, csrf=None, admin=False):
        user = self.auth(token)
        if not user:
            raise LibraryError(401, '请先登录课题组文献库')
        if csrf is not None and not hmac.compare_digest(str(csrf), user['csrf']):
            raise LibraryError(403, '会话校验失败，请刷新后重试')
        if admin and user['role'] != 'admin':
            raise LibraryError(403, '此操作需要管理员权限')
        return user

    def session(self, db, user_id):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        db.execute('INSERT INTO sessions VALUES(?,?,?,?)',
                   (digest(token), user_id, csrf, time.time()+7*86400))
        return token

    def login(self, username, password, peer):
        name = str(username).strip().lower()
        key = digest(peer + ':' + name)
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM attempts WHERE at<?', (time.time()-900,))
            if db.execute('SELECT count(*) FROM attempts WHERE key=?', (key,)).fetchone()[0] >= 8:
                raise LibraryError(429, '尝试次数过多，请 15 分钟后再试')
            record = db.execute('SELECT * FROM users WHERE username=? AND disabled=0', (name,)).fetchone()
            valid = bool(record) and password_matches(password, record['password'])
            if not valid:
                db.execute('INSERT INTO attempts VALUES(?,?)', (key,time.time()))
                db.commit()
                raise LibraryError(401, '账号或密码不正确')
            db.execute('DELETE FROM attempts WHERE key=?', (key,))
            return self.session(db, record['id'])

    def create_invitation(self, role='member', creator=None):
        if self.single_account():raise LibraryError(403,'当前为单共享账号模式，不开放成员注册')
        if role not in ('admin','member'):
            raise LibraryError(400, '不支持的角色')
        token = secrets.token_urlsafe(32)
        with closing(self.connect()) as db, db:
            db.execute('INSERT INTO invitations VALUES(?,?,?,?,?,?)',
                       (digest(token),role,time.time()+7*86400,None,creator,time.time()))
        return token

    def register(self, data):
        if self.single_account():raise LibraryError(403,'当前为单共享账号模式，不开放成员注册')
        name, display = str(data.get('username','')).strip().lower(), str(data.get('display_name','')).strip()
        if not re.fullmatch(r'[a-z0-9_.-]{3,32}',name) or not 1 <= len(display) <= 40:
            raise LibraryError(400, '账号使用 3–32 位字母、数字或 ._-，姓名不超过 40 字')
        token = str(data.get('invitation',''))
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            invite = db.execute('SELECT * FROM invitations WHERE hash=? AND expires>? AND used_by IS NULL',
                                (digest(token),time.time())).fetchone()
            if not invite:
                raise LibraryError(400, '邀请无效、已使用或已过期，请联系管理员')
            if invite['created_by'] is None and invite['role']=='admin' and db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
                raise LibraryError(409, '初始管理员已建立，请使用成员邀请')
            user_id = uuid.uuid4().hex
            password = password_hash(data.get('password'))
            try:
                db.execute('INSERT INTO users(id,username,display_name,password,role,created) VALUES(?,?,?,?,?,?)',
                           (user_id,name,display,password,invite['role'],time.time()))
            except sqlite3.IntegrityError:
                raise LibraryError(409, '该账号已存在，请使用其他账号') from None
            db.execute('UPDATE invitations SET used_by=? WHERE hash=?', (user_id,digest(token)))
            return self.session(db,user_id)

    def logout(self, token):
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM sessions WHERE hash=?', (digest(token or ''),))

    def document(self, document_id):
        with closing(self.connect()) as db:
            record=db.execute('SELECT metadata FROM documents WHERE id=?',(document_id,)).fetchone()
        if not record:
            raise LibraryError(404, '文献不存在')
        return {'id':document_id, **json.loads(record[0])}

    def catalog(self):
        with closing(self.connect()) as db:
            records=db.execute('SELECT id,metadata FROM documents').fetchall()
            counts={r['document_id']:r['n'] for r in db.execute('SELECT document_id,count(*) n FROM annotations WHERE deleted=0 GROUP BY document_id')}
        papers=[]
        for row in records:
            metadata=json.loads(row['metadata'])
            papers.append({'id':row['id'],**metadata,'annotation_count':counts.get(row['id'],0)})
        papers.sort(key=lambda row:(-(row.get('year') or 0),row['title']))
        return {'documents':papers, 'private':True,
                'pdf_count':sum(bool(p.get('pdf')) for p in papers),
                'page_count':sum(p.get('pages',0) for p in papers)}

    def annotation(self, row):
        value=dict(row)
        value['anchor']=json.loads(value['anchor'])
        value['author']=value.pop('display_name',None) or ('原始标注（作者未提供）' if value['origin']=='pdf' else '原始文献库')
        if value.get('byline'):value['author']=value['byline']+'（自填署名）'
        return value

    def annotations(self, document_id):
        self.document(document_id)
        with closing(self.connect()) as db:
            rows=db.execute('''SELECT a.*,u.display_name FROM annotations a LEFT JOIN users u ON u.id=a.author_id
                 WHERE a.document_id=? AND a.deleted=0 ORDER BY a.updated DESC,a.id''',(document_id,)).fetchall()
            version=db.execute('SELECT coalesce(max(id),0) FROM events WHERE document_id=?',(document_id,)).fetchone()[0]
        return {'annotations':[self.annotation(r) for r in rows],'revision':version,'server_time':time.time()}

    def validate_annotation(self, data, document):
        kind=data.get('kind')
        if kind not in ('highlight','area','ink','bookmark','note'):
            raise LibraryError(400,'不支持的标记类型')
        page=data.get('page')
        if page is not None and (type(page) is not int or not 1<=page<=document.get('pages',0)):
            raise LibraryError(400,'标记页码无效')
        if kind!='note' and page is None:
            raise LibraryError(400,'此标记需要页码')
        body,quote=data.get('body',''),data.get('quote','')
        if not isinstance(body,str) or len(body)>12000 or not isinstance(quote,str) or len(quote)>6000:
            raise LibraryError(400,'笔记或引用长度超过限制')
        if kind=='note' and not body.strip():
            raise LibraryError(400,'笔记不能为空')
        color=data.get('color','#f6d568')
        if not isinstance(color,str) or not re.fullmatch('#[0-9a-fA-F]{6}',color):
            raise LibraryError(400,'标记颜色无效')
        anchor=data.get('anchor',{})
        if not isinstance(anchor,dict):
            raise LibraryError(400,'标记坐标无效')
        def point(p):
            return isinstance(p,list) and len(p)==2 and all(type(v) in (float,int) and math.isfinite(v) and 0<=v<=1 for v in p)
        if kind in ('highlight','area'):
            rects=anchor.get('rects')
            if not isinstance(rects,list) or not 1<=len(rects)<=100 or not all(
                isinstance(r,list) and len(r)==4 and point(r[:2]) and point(r[2:]) and r[2]>r[0] and r[3]>r[1] for r in rects):
                raise LibraryError(400,'标记矩形坐标无效')
            anchor={'rects':rects}
        elif kind=='ink':
            points=anchor.get('points')
            if not isinstance(points,list) or not 2<=len(points)<=2000 or not all(point(p) for p in points):
                raise LibraryError(400,'手绘坐标无效')
            anchor={'points':points}
        else:
            anchor={}
        return kind,page,color,body,quote,json.dumps(anchor,ensure_ascii=False)

    def save_annotation(self, user, data, annotation_id=None, delete=False):
        document=self.document(str(data.get('document_id','')))
        byline=data.get('byline','')
        if not isinstance(byline,str) or len(byline)>40:raise LibraryError(400,'阅读署名不超过 40 字')
        byline=byline.strip()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            now=time.time()
            if annotation_id:
                old=db.execute('SELECT * FROM annotations WHERE id=? AND document_id=? AND deleted=0',
                               (annotation_id,document['id'])).fetchone()
                if not old: raise LibraryError(404,'该批注已被删除或不存在')
                if old['origin']!='team': raise LibraryError(403,'原始文献标注只读，不能在这里修改原 PDF')
                if old['author_id']!=user['id'] and user['role']!='admin': raise LibraryError(403,'只能修改本人批注')
                if type(data.get('version')) is not int or data['version']!=old['version']:
                    raise LibraryError(409,'服务器版本已更新，已保留你的本地草稿；请查看最新记录后再修改',current=self.annotation(old))
                if delete:
                    db.execute('UPDATE annotations SET deleted=1,version=version+1,updated=?,last_editor=? WHERE id=?',(now,byline,annotation_id))
                else:
                    fields=self.validate_annotation(data,document)
                    db.execute('''UPDATE annotations SET kind=?,page=?,color=?,body=?,quote=?,anchor=?,updated=?,last_editor=?,version=version+1 WHERE id=?''',(*fields,now,byline,annotation_id))
            else:
                fields=self.validate_annotation(data,document)
                annotation_id=uuid.uuid4().hex
                db.execute('''INSERT INTO annotations(id,document_id,author_id,kind,page,color,body,quote,anchor,created,updated)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(annotation_id,document['id'],user['id'],*fields,now,now))
                db.execute('UPDATE annotations SET byline=?,last_editor=? WHERE id=?',(byline,byline,annotation_id))
            row=db.execute('SELECT a.*,u.display_name FROM annotations a LEFT JOIN users u ON u.id=a.author_id WHERE a.id=?',(annotation_id,)).fetchone()
            snapshot=self.annotation(row)
            db.execute('INSERT INTO events(document_id,annotation_id,actor,operation,snapshot,created) VALUES(?,?,?,?,?,?)',
                       (document['id'],annotation_id,user['id'],'delete' if delete else 'update' if data.get('version') else 'create',json.dumps(snapshot,ensure_ascii=False),now))
        return snapshot

    def members(self):
        with closing(self.connect()) as db:
            return [dict(r) for r in db.execute('SELECT id,username,display_name,role,disabled,created FROM users ORDER BY created')]

    def update_member(self, user, data):
        target=str(data.get('user_id',''))
        if target==user['id']: raise LibraryError(400,'不能在此停用或更改自己的管理员角色')
        disabled=data.get('disabled',False)
        if type(disabled) is not bool: raise LibraryError(400,'成员状态无效')
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM users WHERE id=?',(target,)).fetchone(): raise LibraryError(404,'成员不存在')
            if not db.execute('SELECT 1 FROM users WHERE id=? AND disabled=0',(user['id'],)).fetchone():raise LibraryError(403,'管理员会话已失效')
            if disabled and db.execute("SELECT role FROM users WHERE id=?",(target,)).fetchone()[0]=='admin' and db.execute("SELECT count(*) FROM users WHERE role='admin' AND disabled=0").fetchone()[0]<=1:
                raise LibraryError(400,'至少需要保留一名启用的管理员')
            db.execute('UPDATE users SET disabled=? WHERE id=?',(int(disabled),target))
            if disabled: db.execute('DELETE FROM sessions WHERE user_id=?',(target,))

    def change_password(self,user,data):
        with closing(self.connect()) as db, db:
            row=db.execute('SELECT password FROM users WHERE id=? AND disabled=0',(user['id'],)).fetchone()
            if not row or not password_matches(data.get('old_password'),row[0]):raise LibraryError(400,'当前密码不正确')
            value=password_hash(data.get('new_password'))
            db.execute('UPDATE users SET password=? WHERE id=?',(value,user['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
            return self.session(db,user['id'])

    def file(self, document_id, kind):
        document=self.document(document_id)
        sha=document.get('pdf')
        if not sha or not re.fullmatch('[a-f0-9]{64}',sha): raise LibraryError(404,'该条目没有 PDF 附件')
        return self.root / ('pdfs' if kind=='pdf' else 'covers') / (sha+('.pdf' if kind=='pdf' else '.jpg'))
