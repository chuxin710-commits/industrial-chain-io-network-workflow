"""Run private browser checks without persisting shared account credentials."""
import argparse
import getpass
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='https://nn.rftf.cc.cd')
parser.add_argument('--username', default='zeltears')
args = parser.parse_args()
password = getpass.getpass('Library password (hidden): ')
result = subprocess.run(['D:/Galgame/node.exe', 'scripts/verify-literature-ai.mjs', '--base', args.base],
                        input=json.dumps({'username': args.username, 'password': password}),
                        text=True, cwd=Path(__file__).resolve().parents[1])
raise SystemExit(result.returncode)
