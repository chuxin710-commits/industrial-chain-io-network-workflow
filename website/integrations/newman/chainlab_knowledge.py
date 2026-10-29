"""Trusted read-only tool transport; service credentials never enter a sandbox."""
import asyncio
import urllib.error
from pathlib import Path

from backend.plugin_runtime.chainlab_kb_cli import run


def is_chainlab_command(command):
    return (command.plugin_name == 'external-kb-retrieval'
            and command.tool_name == 'external_kb_retrieve'
            and Path(command.executable).name == 'chainlab_kb_cli.py')


async def run_chainlab_command(args, payload):
    if len(args) != 1 or args[0] not in ('doctor', 'health', 'list-kbs', 'list-datasets', 'retrieve'):
        return {'success': False, 'provider': 'chainlab', 'error': {
            'type': 'validation_error', 'message': 'Unsupported read-only knowledge operation'}}
    try:
        return await asyncio.to_thread(run, args[0], payload)
    except urllib.error.HTTPError as exc:
        return {'success': False, 'provider': 'chainlab', 'error': {
            'type': 'provider_request_error', 'message': f'课题组知识库请求失败（HTTP {exc.code}）', 'retryable': exc.code >= 500}}
    except (OSError, ValueError):
        return {'success': False, 'provider': 'chainlab', 'error': {
            'type': 'provider_connection_error', 'message': '课题组知识库暂不可用，请稍后重试', 'retryable': True}}
