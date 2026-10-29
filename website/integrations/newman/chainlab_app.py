"""ChainLab authentication boundary around the unmodified Newman ASGI runtime."""
import os

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

# Never place model credentials in the frontend, YAML, or editable .env file.
os.environ['NEWMAN_AUTH__ENABLED'] = 'false'
for role in ('PRIMARY', 'MULTIMODAL'):
    os.environ[f'NEWMAN_MODELS_{role}_API_KEY'] = os.environ['DEEPSEEK_API_KEY']
    os.environ[f'NEWMAN_MODELS_{role}_MODEL'] = os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash')

from backend.api.app import app as newman_app  # noqa: E402


class ChainLabBoundary:
    def __init__(self, inner, session_url='http://127.0.0.1:8787/api/library/session'):
        self.inner = inner
        self.session_url = session_url

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            if scope['type'] == 'websocket':
                await send({'type': 'websocket.close', 'code': 1008})
                return
            await self.inner(scope, receive, send)
            return
        request = Request(scope, receive)
        path = scope['path']
        if path in ('/healthz', '/readyz'):
            # Only minimal health information is public; never runtime paths/config.
            await JSONResponse({'ok': True, 'service': 'chainlab-toolbench'})(scope, receive, send)
            return
        if not path.startswith('/api/') and path not in ('/docs', '/redoc', '/openapi.json'):
            await self.inner(scope, receive, send)
            return
        try:
            async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                result = await client.get(self.session_url, headers={'Cookie': request.headers.get('cookie', '')})
                result.raise_for_status()
                user = result.json().get('user')
        except (httpx.HTTPError, ValueError):
            await JSONResponse({'detail': '课题组登录服务暂不可用，请稍后重试'}, status_code=503)(scope, receive, send)
            return
        if path == '/api/auth/status':
            await JSONResponse({'enabled': True, 'needs_setup': False, 'authenticated': bool(user),
                                'auth_method': 'chainlab' if user else None, 'admin_token_configured': True})(scope, receive, send)
            return
        if not user:
            await JSONResponse({'detail': '请使用课题组账号登录'}, status_code=401)(scope, receive, send)
            return
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            allowed = os.environ.get('CHAINLAB_ORIGIN', 'https://nn.rftf.cc.cd')
            if request.headers.get('origin') != allowed:
                await JSONResponse({'detail': '不接受跨站写入'}, status_code=403)(scope, receive, send)
                return
        if path.startswith(('/api/bootstrap', '/api/auth/')):
            await JSONResponse({'detail': '账号由 ChainLab 统一管理'}, status_code=403)(scope, receive, send)
            return
        await self.inner(scope, receive, send)


app = ChainLabBoundary(newman_app)
