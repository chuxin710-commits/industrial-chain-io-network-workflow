"""HTTP adapter for the private library; MRIO routes remain read-only."""

import json
from http.cookies import SimpleCookie, CookieError
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

from library import LibraryError
from literature_ai import engine
from method_tutor import tutor


def reply(handler, status, value=None, token=None, etag=None):
    body=json.dumps(value,ensure_ascii=False,allow_nan=False).encode() if value is not None else b''
    handler.send_response(status)
    handler.send_header('Content-Type','application/json; charset=utf-8')
    handler.send_header('Content-Length',str(len(body)))
    handler.send_header('Cache-Control','no-store')
    handler.send_header('X-Content-Type-Options','nosniff')
    if etag:handler.send_header('ETag',etag)
    if token is not None:
        host=handler.headers.get('Host','').split(':')[0]
        secure='' if host in ('localhost','127.0.0.1','[::1]') else '; Secure'
        handler.send_header('Set-Cookie',f'chainlab_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={604800 if token else 0}{secure}')
    handler.end_headers();handler.response_started=True
    if handler.command!='HEAD':handler.wfile.write(body)


def serve_file(handler,path,kind):
    if not path.is_file():raise LibraryError(404,'附件文件暂不可用')
    size=path.stat().st_size;start,end=0,size-1;status=200
    value=handler.headers.get('Range')
    if value:
        match=re.fullmatch(r'bytes=(\d*)-(\d*)',value)
        if not match or not any(match.groups()):raise LibraryError(416,'不支持的字节范围')
        if match[1]:start=int(match[1]);end=min(int(match[2]),end) if match[2] else end
        else:start=max(0,size-int(match[2]))
        if start>=size or end<start:
            handler.send_response(416);handler.send_header('Content-Range',f'bytes */{size}');handler.send_header('Content-Length','0');handler.end_headers();return
        status=206
    handler.send_response(status)
    handler.send_header('Content-Type','application/pdf' if kind=='pdf' else 'image/jpeg')
    handler.send_header('Content-Length',str(end-start+1))
    handler.send_header('Accept-Ranges','bytes')
    handler.send_header('Content-Disposition',f'inline; filename="{path.name}"')
    handler.send_header('Cache-Control','private, no-store')
    handler.send_header('X-Content-Type-Options','nosniff')
    if status==206:handler.send_header('Content-Range',f'bytes {start}-{end}/{size}')
    handler.end_headers();handler.response_started=True
    if handler.command=='HEAD':return
    with path.open('rb') as source:
        source.seek(start);remaining=end-start+1
        while remaining:
            block=source.read(min(262144,remaining))
            if not block:break
            handler.wfile.write(block);remaining-=len(block)


def handle_library(handler):
    store=handler.server.library
    if store is None:
        reply(handler,503,{'error':'文献库尚未完成导入，请稍后重试'});return
    try:
        parsed=urlsplit(handler.path);method=handler.command
        if len(parsed.query)>2048:raise LibraryError(400,'查询参数过长')
        values=parse_qs(parsed.query,keep_blank_values=True,max_num_fields=6)
        if any(len(v)!=1 for v in values.values()):raise LibraryError(400,'参数不可重复')
        params={k:v[0] for k,v in values.items()}
        cookie=SimpleCookie();cookie.load(handler.headers.get('Cookie',''))
        token=cookie['chainlab_session'].value if 'chainlab_session' in cookie else ''
        if method not in ('GET','HEAD'):
            origin=handler.headers.get('Origin','')
            host=handler.headers.get('Host','')
            if origin and urlsplit(origin).netloc!=host:raise LibraryError(403,'不接受跨站写入')
            if not origin and host.split(':')[0] not in ('localhost','127.0.0.1'):raise LibraryError(403,'缺少来源校验')
            if handler.headers.get_content_type()!='application/json':raise LibraryError(415,'请求需要 JSON')
            try:length=int(handler.headers.get('Content-Length','0'))
            except ValueError:raise LibraryError(400,'请求长度无效') from None
            if not 0<length<=100000:raise LibraryError(413,'请求体过大或为空')
            try:data=json.loads(handler.rfile.read(length))
            except (ValueError,UnicodeDecodeError):raise LibraryError(400,'JSON 格式无效') from None
            if not isinstance(data,dict):raise LibraryError(400,'请求体必须为对象')
        else:data={}
        path=parsed.path
        if path=='/api/library/session' and method=='GET':
            reply(handler,200,{'user':store.auth(token),'single_account':store.single_account()});return
        if path in ('/api/library/auth/login','/api/library/auth/register') and method=='POST':
            new_token=store.login(data.get('username',''),data.get('password'),handler.headers.get('X-Real-IP',handler.client_address[0])) if path.endswith('login') else store.register(data)
            reply(handler,200,{'user':store.auth(new_token)},token=new_token);return
        user=store.require(token, handler.headers.get('X-CSRF-Token','') if method not in ('GET','HEAD') else None)
        if path=='/api/library/auth/logout' and method=='POST':
            store.logout(token);reply(handler,200,{'ok':True},token='');return
        if path=='/api/library/auth/password' and method=='POST':
            new_token=store.change_password(user,data);reply(handler,200,{'user':store.auth(new_token)},token=new_token);return
        if path=='/api/library/documents' and method=='GET':
            reply(handler,200,engine(handler.server).catalog());return
        if path=='/api/library/ai/status' and method=='GET':
            reply(handler,200,engine(handler.server).catalog()['ai_status']);return
        if path=='/api/library/ai/framework' and method=='POST':
            reply(handler,202,engine(handler.server).start(data.get('theme')));return
        if path=='/api/library/ai/explain' and method=='POST':
            reply(handler,202,tutor(handler.server).start(user['id'],data));return
        if path=='/api/library/ai/topology' and method=='POST':
            from topology_ai import analyst
            reply(handler,202,analyst(handler.server).start(user['id'],data));return
        topology_job=re.fullmatch('/api/library/ai/topology/([a-f0-9]{32})',path)
        if topology_job and method=='GET':
            from topology_ai import analyst
            reply(handler,200,analyst(handler.server).job(user['id'],topology_job[1]));return
        explanation=re.fullmatch('/api/library/ai/explain/([a-f0-9]{32})',path)
        if explanation and method=='GET':
            reply(handler,200,tutor(handler.server).job(user['id'],explanation[1]));return
        ai_job=re.fullmatch('/api/library/ai/framework/([a-f0-9]{32})',path)
        if ai_job and method=='GET':
            reply(handler,200,engine(handler.server).job(ai_job[1]));return
        file=re.fullmatch('/api/library/documents/([a-f0-9]{32})/(pdf|cover)',path)
        if file and method in ('GET','HEAD'):
            serve_file(handler,store.file(file[1],file[2]),file[2]);return
        if path=='/api/library/annotations' and method=='GET':
            if set(params)!={'document_id'}:raise LibraryError(400,'需要文献标识')
            value=store.annotations(params['document_id']);etag=f'"annotations-{params["document_id"]}-{value["revision"]}"'
            reply(handler,304 if handler.headers.get('If-None-Match')==etag else 200,None if handler.headers.get('If-None-Match')==etag else value,etag=etag);return
        if path=='/api/library/annotations' and method=='POST':
            reply(handler,201,store.save_annotation(user,data));return
        annotation=re.fullmatch('/api/library/annotations/([a-f0-9]{32})',path)
        if annotation and method in ('PATCH','DELETE'):
            reply(handler,200,store.save_annotation(user,data,annotation[1],delete=method=='DELETE'));return
        if path=='/api/library/export' and method=='GET':
            if set(params)!={'document_id'}:raise LibraryError(400,'需要文献标识')
            reply(handler,200,{'document':store.document(params['document_id']),**store.annotations(params['document_id'])});return
        if path=='/api/library/members' and method=='GET':
            store.require(token,admin=True);reply(handler,200,{'members':store.members()});return
        if path=='/api/library/members' and method=='PATCH':
            store.require(token,admin=True);store.update_member(user,data);reply(handler,200,{'ok':True});return
        if path=='/api/library/invitations' and method=='POST':
            store.require(token,admin=True);invitation=store.create_invitation(data.get('role','member'),creator=user['id']);reply(handler,201,{'invitation':invitation,'expires_days':7});return
        raise LibraryError(404,'未找到此文献库接口')
    except LibraryError as error:reply(handler,error.status,error.data)
    except (ValueError,CookieError):reply(handler,400,{'error':'文献库请求格式无效'})
    except (BrokenPipeError,ConnectionResetError):pass
    except (sqlite3.Error,OSError,RuntimeError):
        handler.log_error('Library operation failed')
        if not handler.response_started:reply(handler,503,{'error':'文献库暂时不可用，草稿尚未提交，请重试'})
