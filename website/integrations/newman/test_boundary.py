"""Authentication adapter tests without loading any real model/runtime configuration."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import httpx
from starlette.responses import JSONResponse

async def inner(scope, receive, send):
    await JSONResponse({'runtime': True})(scope, receive, send)

stub = types.ModuleType('backend.api.app')
stub.app = inner
spec = importlib.util.spec_from_file_location('tested_adapter', Path(__file__).with_name('chainlab_app.py'))
module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'backend.api.app': stub}), patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-only', 'DEEPSEEK_MODEL': 'test-model'}):
    spec.loader.exec_module(module)

class BoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, path, user=None, method='GET', origin=None, unavailable=False):
        real_client = httpx.AsyncClient
        def session_reply(request):
            if unavailable:
                raise httpx.ConnectError('unavailable', request=request)
            return httpx.Response(200, json={'user': user})
        transport = httpx.MockTransport(session_reply)
        def client_factory(**kwargs):
            return real_client(transport=transport, **kwargs)
        app = module.ChainLabBoundary(inner)
        async with real_client(transport=httpx.ASGITransport(app=app), base_url='https://nn.rftf.cc.cd') as client:
            with patch.object(module.httpx, 'AsyncClient', client_factory):
                return await client.request(method, path, headers={'origin': origin} if origin else {})

    async def test_anonymous_cannot_read_sessions(self):
        self.assertEqual((await self.request('/api/sessions')).status_code, 401)

    async def test_status_allows_login_but_does_not_claim_authenticated(self):
        value = (await self.request('/api/auth/status')).json()
        self.assertFalse(value['authenticated'])
        self.assertFalse(value['needs_setup'])

    async def test_group_session_accepted(self):
        self.assertEqual((await self.request('/api/sessions', {'id': 'test'})).json(), {'runtime': True})

    async def test_write_requires_matching_origin(self):
        for origin in (None, 'https://other.invalid'):
            self.assertEqual((await self.request('/api/sessions', {'id': 'test'}, 'POST', origin)).status_code, 403)
        self.assertEqual((await self.request('/api/sessions', {'id': 'test'}, 'POST', 'https://nn.rftf.cc.cd')).status_code, 200)

    async def test_auth_service_failure_is_closed(self):
        self.assertEqual((await self.request('/api/sessions', unavailable=True)).status_code, 503)

    async def test_no_bootstrap_bypass(self):
        self.assertEqual((await self.request('/api/bootstrap/status', {'id': 'test'})).status_code, 403)

    async def test_public_shell_and_minimal_health(self):
        self.assertEqual((await self.request('/')).status_code, 200)
        self.assertEqual((await self.request('/healthz')).json(), {'ok': True, 'service': 'chainlab-toolbench'})

if __name__ == '__main__':
    unittest.main()
