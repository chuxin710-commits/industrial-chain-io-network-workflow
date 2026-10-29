"""Run with the materialized Newman release on PYTHONPATH, using its venv."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.api.routes.external_kb import _run_external_kb_command
from backend.plugin_runtime.command_argv import plugin_command_argv
from backend.plugin_runtime.models import ResolvedPluginCLICommand
from backend.tools.impl.plugin_cli import PluginCLICommandTool
from backend.tools.result import ToolExecutionResult


class PluginStartupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="plugin startup ")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.script = self.root / "cli.py"
        # Deliberately no shebang, CRLF line endings, and no executable permission.
        self.script.write_bytes(
            b"import json, sys\r\n"
            b"payload = json.load(sys.stdin) if 'retrieve' in sys.argv else {}\r\n"
            b"print(json.dumps({'success': True, 'args': sys.argv[1:], 'payload': payload}))\r\n"
        )
        self.script.chmod(0o644)
        self.command = ResolvedPluginCLICommand(
            plugin_name="external-kb-retrieval", plugin_root=str(self.root),
            tool_name="external_kb_retrieve", executable=str(self.script),
            default_args=["--fixture"], readonly_prefixes=[["doctor"], ["retrieve"]],
        )

    async def test_api_runs_nonexecutable_python(self):
        if os.name != "nt":
            self.assertFalse(os.access(self.script, os.X_OK))
        result = await _run_external_kb_command(self.command, ["doctor"], {})
        self.assertTrue(result["success"])
        self.assertEqual(result["args"], ["--fixture", "doctor"])

    async def test_api_preserves_json_stdin_and_argument_boundaries(self):
        payload = {"query": "a query; not a shell command", "top_k": 3}
        result = await _run_external_kb_command(self.command, ["retrieve"], payload)
        self.assertEqual(result["payload"], payload)

    async def test_agent_uses_same_interpreter_without_changing_readonly_checks(self):
        tool = PluginCLICommandTool(self.command, sandbox=None)
        result = ToolExecutionResult(success=True, tool="fixture", action="doctor", stdout="{}")
        with patch.object(tool, "_execute_argv", new=AsyncMock(return_value=result)) as execute:
            await tool.run({"args": ["doctor"]}, session_id="startup-test")
        self.assertEqual(execute.call_args.args[0], [sys.executable, str(self.script), "--fixture", "doctor"])
        self.assertEqual(tool.static_checks({"args": ["doctor"]}), [])
        self.assertEqual(tool.static_checks({"args": ["delete"]}), ["plugin_cli_mutating"])

    async def test_relative_script_uses_plugin_root(self):
        self.command.executable = "cli.py"
        self.assertEqual(plugin_command_argv(self.command, ["doctor"])[1], str(self.script))

    async def test_non_python_commands_unchanged(self):
        self.command.executable = "lark-cli"
        self.assertEqual(plugin_command_argv(self.command, ["auth", "status"]), ["lark-cli", "--fixture", "auth", "status"])

    async def test_missing_script_still_reports_startup_error(self):
        from fastapi import HTTPException
        self.command.executable = str(self.root / "missing.py")
        with self.assertRaises(HTTPException) as caught:
            await _run_external_kb_command(self.command, ["doctor"], {})
        self.assertEqual(caught.exception.status_code, 502)

    async def test_provider_configuration_failure_remains_structured(self):
        payload = {"success": False, "error": {"type": "provider_auth_error", "message": "Missing API key"}}
        self.script.write_text("import json\nprint(json.dumps(" + repr(payload) + "))\n", encoding="utf-8")
        result = await _run_external_kb_command(self.command, ["health"], {})
        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["type"], "provider_auth_error")


@unittest.skipUnless(os.environ.get("CHAINLAB_PLUGIN_SMOKE_ROOT"), "Optional deployed plugin smoke test")
class DeployedPluginTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_plugin_doctor_inside_bubblewrap(self):
        from backend.config.schema import SandboxConfig
        from backend.sandbox.native_sandbox import NativeSandbox
        from backend.sandbox.resource_limits import ResourceLimits

        root = Path(os.environ["CHAINLAB_PLUGIN_SMOKE_ROOT"])
        plugin = root / "plugins/external-kb-retrieval"
        command = ResolvedPluginCLICommand(
            plugin_name="external-kb-retrieval", plugin_root=str(plugin),
            tool_name="external_kb_retrieve", executable=str(plugin / "scripts/external_kb_cli.py"),
            readable_roots=[str(plugin), str(root / "backend_data")],
            readonly_prefixes=[["doctor"]],
        )
        sandbox = NativeSandbox(
            root / "workspace", ResourceLimits(timeout_seconds=30, output_limit_bytes=20000),
            SandboxConfig(backend="linux_bwrap", network_access=False),
            extra_readable_roots=[Path(sys.prefix)],
        )
        self.assertTrue(sandbox.health().available)
        result = await PluginCLICommandTool(command, sandbox=sandbox).run({"args": ["doctor"]}, session_id="startup-smoke")
        self.assertTrue(result.success, result.stderr or result.summary)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["command"], "doctor")

    @unittest.skipUnless(os.environ.get("CHAINLAB_KB_BRIDGE_TOKEN"), "Optional private bridge test")
    async def test_chainlab_retrieval_uses_trusted_readonly_transport(self):
        from backend.config.schema import SandboxConfig
        from backend.sandbox.native_sandbox import NativeSandbox
        from backend.sandbox.resource_limits import ResourceLimits

        root = Path(os.environ["CHAINLAB_PLUGIN_SMOKE_ROOT"])
        plugin = root / "plugins/external-kb-retrieval"
        command = ResolvedPluginCLICommand(
            plugin_name="external-kb-retrieval", plugin_root=str(plugin), tool_name="external_kb_retrieve",
            executable=str(plugin / "scripts/chainlab_kb_cli.py"), readable_roots=[str(plugin)],
            env={"CHAINLAB_KB_BRIDGE_TOKEN": os.environ["CHAINLAB_KB_BRIDGE_TOKEN"]}, readonly_prefixes=[["retrieve"]],
        )
        sandbox = NativeSandbox(root / "workspace", ResourceLimits(30, 30000),
                                SandboxConfig(backend="linux_bwrap", network_access=True),
                                extra_readable_roots=[Path(sys.prefix)])
        request = {"query": "投入产出网络与产业链韧性", "knowledge_base_ids": ["chainlab-literature"],
                   "top_k": 3, "score_threshold": 0.06}
        with patch.object(sandbox, 'execute_argv', new=AsyncMock()) as execute:
            response = await PluginCLICommandTool(command, sandbox=sandbox).run(
                {"args": ["retrieve"], "stdin": json.dumps(request, ensure_ascii=False)}, session_id="bridge-smoke")
            execute.assert_not_called()
        self.assertTrue(response.success, response.stderr or response.summary)
        payload = json.loads(response.stdout)
        self.assertTrue(payload["success"], payload.get("error"))
        self.assertGreater(payload["total"], 0)
        self.assertTrue(all(s["metadata"]["kind"] == "paper" for s in payload["results"]))


if __name__ == "__main__":
    unittest.main()
