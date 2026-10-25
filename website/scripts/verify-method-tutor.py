"""Live browser acceptance with in-memory credentials only."""
import getpass
import json
from pathlib import Path
import subprocess

password = getpass.getpass('Library password (hidden): ')
result = subprocess.run(['D:/Galgame/node.exe', 'scripts/verify-method-tutor.mjs', '--live', '--base', 'https://nn.rftf.cc.cd'],
                        input=json.dumps({'username': 'zeltears', 'password': password}), text=True,
                        cwd=Path(__file__).resolve().parents[1])
raise SystemExit(result.returncode)
