"""Passive skill catalog and account-scoped Markdown storage, never execution."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

import yaml
from library import LibraryError


MAX_BYTES = 40000


def parse_skill(content, filename='SKILL.md'):
    if not isinstance(filename, str) or filename.lower() != 'skill.md':
        raise LibraryError(400, '请上传名为 SKILL.md 的文件')
    if not isinstance(content, str) or not content.strip():
        raise LibraryError(400, '技能文件不能为空')
    if len(content.encode('utf-8')) > MAX_BYTES:
        raise LibraryError(413, 'SKILL.md 最大为 40 KB')
    content = content.lstrip('\ufeff').replace('\r\n', '\n')
    if any(ord(c) < 32 and c not in '\t\n\r' for c in content):
        raise LibraryError(400, '文件必须为 UTF-8 文本')
    match = re.match(r'\A---\n(.*?)\n---[ \t]*\n(.*)\Z', content, re.S)
    if not match or not match[2].strip():
        raise LibraryError(400, '需要 YAML 头部（name、description）及技能正文')
    if len(match[1].encode()) > 8192:
        raise LibraryError(400, 'YAML 头部过长')
    try:
        header = yaml.safe_load(match[1])
    except (yaml.YAMLError, RecursionError):
        raise LibraryError(400, 'YAML 头部格式不正确') from None
    if not isinstance(header, dict):
        raise LibraryError(400, 'YAML 头部必须包含 name 和 description')
    name, description = header.get('name'), header.get('description')
    if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) or len(name) > 64:
        raise LibraryError(400, 'name 须为不超过 64 位的小写字母、数字及单连字符')
    if not isinstance(description, str) or not 1 <= len(description.strip()) <= 1024:
        raise LibraryError(400, 'description 须为 1–1024 字的文字说明')
    return dict(name=name, summary=description.strip(), content=content,
                sha256=hashlib.sha256(content.encode()).hexdigest())


class SkillHub:
    def __init__(self, library):
        self.library = library
        self.catalog = json.loads(Path(__file__).with_name('skillhub_catalog.json').read_text(encoding='utf-8'))

    def curated(self, identifier):
        return next((item for item in self.catalog['items'] if item['id'] == identifier), None)

    def listing(self, user):
        favorites, owned = set(), []
        if user:
            with closing(self.library.connect()) as db:
                favorites = {row[0] for row in db.execute('SELECT skill_id FROM skill_favorites WHERE owner=?', (user['id'],))}
                owned = [dict(row) for row in db.execute('SELECT * FROM personal_skills WHERE owner=? ORDER BY updated DESC', (user['id'],))]
        items = [{**item, 'kind': 'curated'} for item in self.catalog['items']]
        items += [{**item, 'kind': 'personal', 'title': item['name'], 'category': '专属技能'} for item in owned]
        for item in items:
            item.pop('content', None)
            item.pop('license_text', None)
            item.pop('owner', None)
            item['favorite'] = item['id'] in favorites
        return dict(items=items, checked_at=self.catalog['checked_at'])

    def get(self, identifier, user):
        curated = self.curated(identifier)
        if curated:
            return {**curated, 'kind': 'curated'}
        if user:
            with closing(self.library.connect()) as db:
                row = db.execute('SELECT * FROM personal_skills WHERE id=? AND owner=?', (identifier, user['id'])).fetchone()
            if row:
                result = dict(row)
                result.pop('owner')
                return {**result, 'kind': 'personal'}
        raise LibraryError(404, '技能不存在或不属于当前账号')

    def save(self, user, data):
        value = parse_skill(data.get('content'), data.get('filename'))
        identifier = uuid.uuid4().hex
        with closing(self.library.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM personal_skills WHERE owner=? AND name=?', (user['id'], value['name'])).fetchone():
                raise LibraryError(409, '已有同名技能，请先下载备份并删除旧版，再上传新版')
            if db.execute('SELECT count(*) FROM personal_skills WHERE owner=?', (user['id'],)).fetchone()[0] >= 100:
                raise LibraryError(400, '每个账号最多保存 100 个专属技能')
            db.execute('INSERT INTO personal_skills VALUES(?,?,?,?,?,?,?)',
                       (identifier, user['id'], value['name'], value['summary'], value['content'], value['sha256'], time.time()))
        return self.get(identifier, user)

    def delete(self, user, identifier):
        if self.get(identifier, user)['kind'] != 'personal':
            raise LibraryError(403, '精选技能不能删除')
        with closing(self.library.connect()) as db, db:
            db.execute('DELETE FROM personal_skills WHERE id=? AND owner=?', (identifier, user['id']))
            db.execute('DELETE FROM skill_favorites WHERE skill_id=? AND owner=?', (identifier, user['id']))
        return {'ok': True}

    def favorite(self, user, identifier, enabled):
        self.get(identifier, user)
        if not isinstance(enabled, bool):
            raise LibraryError(400, '收藏状态无效')
        with closing(self.library.connect()) as db, db:
            if enabled:
                db.execute('INSERT OR IGNORE INTO skill_favorites VALUES(?,?)', (user['id'], identifier))
            else:
                db.execute('DELETE FROM skill_favorites WHERE owner=? AND skill_id=?', (user['id'], identifier))
        return {'ok': True}


def route(handler, path, method, user, data):
    from library_http import reply
    hub = SkillHub(handler.server.library)
    if path == '/api/library/skills' and method == 'GET':
        reply(handler, 200, hub.listing(user))
        return
    if path == '/api/library/skills' and method == 'POST':
        reply(handler, 201, hub.save(user, data))
        return
    match = re.fullmatch(r'/api/library/skills/([a-z0-9-]{1,120})(/download|/favorite)?', path)
    if match:
        identifier, action = match.groups()
        if method == 'DELETE' and not action:
            reply(handler, 200, hub.delete(user, identifier))
            return
        if method == 'POST' and action == '/favorite':
            reply(handler, 200, hub.favorite(user, identifier, data.get('enabled')))
            return
        if method == 'GET':
            item = hub.get(identifier, user)
            if not action:
                reply(handler, 200, item)
                return
            if action == '/download':
                body = item['content'].encode('utf-8')
                handler.send_response(200)
                handler.send_header('Content-Type', 'text/markdown; charset=utf-8')
                handler.send_header('Content-Disposition', 'attachment; filename="SKILL.md"')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('X-Content-Type-Options', 'nosniff')
                handler.send_header('Cache-Control', 'private, no-store')
                handler.end_headers()
                handler.response_started = True
                handler.wfile.write(body)
                return
    raise LibraryError(404, '技能接口不存在')
