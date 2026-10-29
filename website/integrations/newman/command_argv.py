from __future__ import annotations

import sys
from pathlib import Path

from backend.plugin_runtime.models import ResolvedPluginCLICommand


def plugin_command_argv(command: ResolvedPluginCLICommand, args: list[str]) -> list[str]:
    """Run local Python entrypoints with the runtime's installed dependencies."""
    executable = Path(command.executable)
    script = executable if executable.is_absolute() else Path(command.plugin_root) / executable
    # Windows-built archives do not retain POSIX execute bits or portable shebangs.
    if script.suffix.lower() == ".py" and script.is_file():
        return [sys.executable, str(script.absolute()), *command.default_args, *args]
    return [command.executable, *command.default_args, *args]
