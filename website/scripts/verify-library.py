"""Prompt without echo, then run the browser acceptance suite with stdin credentials."""
import argparse
import getpass
import json
from pathlib import Path
import subprocess

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',default='http://127.0.0.1:5188')
p.add_argument('--username',default='zeltears');p.add_argument('--node',default='D:/Galgame/node.exe')
p.add_argument('--layout-only',action='store_true')
p.add_argument('--stability-only',action='store_true')
p.add_argument('--continuous-only',action='store_true')
a=p.parse_args();password=getpass.getpass('Library password (input hidden): ')
result=subprocess.run([a.node,'scripts/verify-library.mjs','--base',a.base]+(['--layout-only'] if a.layout_only else [])+(['--stability-only'] if a.stability_only else [])+(['--continuous-only'] if a.continuous_only else []),input=json.dumps({'username':a.username,'password':password}),text=True,cwd=Path(__file__).resolve().parents[1])
raise SystemExit(result.returncode)
