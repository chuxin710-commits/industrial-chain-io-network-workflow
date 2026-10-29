"""Run as root on the deployment host after uploading a verified toolbench archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import tarfile
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--archive', required=True, type=Path)
parser.add_argument('--sha256', required=True)
args = parser.parse_args()
assert hashlib.sha256(args.archive.read_bytes()).hexdigest() == args.sha256, 'Archive hash mismatch'
base = Path('/opt/chainlab-toolbench')
data = Path('/var/lib/chainlab-toolbench')
release = base / 'releases' / args.archive.name.removeprefix('toolbench-').removesuffix('.tar.gz')
release.mkdir(parents=True, exist_ok=False)
with tarfile.open(args.archive) as archive:
    for member in archive.getmembers():
        resolved = (release / member.name).resolve()
        assert resolved.is_relative_to(release) and member.isfile(), 'Unexpected archive member'
    archive.extractall(release)
try:
    pwd.getpwnam('chainlab-tools')
except KeyError:
    subprocess.run(['useradd', '--system', '--home-dir', str(data), '--shell', '/usr/sbin/nologin', 'chainlab-tools'], check=True)
data.mkdir(exist_ok=True)
for name in ('workspace', 'backend_data', 'skills', 'plugins'):
    (data / name).mkdir(exist_ok=True)
for name in ('skills', 'plugins'):
    for source in (release / name).iterdir():
        target = data / name / source.name
        if not target.exists():
            shutil.copytree(source, target) if source.is_dir() else shutil.copy2(source, target)
if not (data / 'newman.yaml').exists():
    shutil.copy2(release / 'newman.yaml', data / 'newman.yaml')
config = data / 'newman.yaml'
config.write_text(config.read_text().replace('readable_paths: [workspace, skills, plugins]', 'readable_paths: [workspace, skills, plugins, /opt/chainlab-toolbench/venv]'))
plugin_manifest = data / 'plugins/external-kb-retrieval/plugin.yaml'
if plugin_manifest.exists():
    plugin_manifest.write_text(plugin_manifest.read_text().replace('/root/newman/backend_data', '../../backend_data'))
    text = plugin_manifest.read_text()
    text = text.replace('executable: scripts/external_kb_cli.py', 'executable: scripts/chainlab_kb_cli.py')
    text = text.replace('path: skills/external-kb-retrieval/CHAINLAB.md', 'path: skills/external-kb-retrieval/SKILL.md')
    text = text.replace('      CHAINLAB_KB_BRIDGE_TOKEN: ${CHAINLAB_KB_BRIDGE_TOKEN}\n', '')
    plugin_manifest.write_text(text)
    skill = plugin_manifest.parent / 'skills/external-kb-retrieval/SKILL.md'
    backup = skill.with_name('SKILL.before-chainlab.md')
    if skill.exists() and not backup.exists():
        shutil.copy2(skill, backup)
    for relative in ('scripts/chainlab_kb_cli.py', 'skills/external-kb-retrieval/SKILL.md'):
        shutil.copy2(release / 'plugins/external-kb-retrieval' / relative, plugin_manifest.parent / relative)
bridge_env = Path('/etc/chainlab/toolbench-kb.env')
if not bridge_env.exists():
    with bridge_env.open('x') as output:
        output.write('CHAINLAB_KB_BRIDGE_TOKEN=' + secrets.token_urlsafe(48) + '\n')
bridge_env.chmod(0o600)
dropin = Path('/etc/systemd/system/chainlab-api.service.d')
dropin.mkdir(exist_ok=True)
(dropin / 'toolbench-kb.conf').write_text('[Service]\nEnvironmentFile=/etc/chainlab/toolbench-kb.env\n')
subprocess.run(['chown', '-R', 'chainlab-tools:chainlab-tools', str(data)], check=True)
data.chmod(0o700)
venv = base / 'venv'
if not venv.exists():
    subprocess.run(['python3', '-m', 'venv', str(venv)], check=True)
subprocess.run([str(venv / 'bin/pip'), 'install', '--disable-pip-version-check', '--constraint', str(release / 'requirements.lock'), str(release / 'backend')], check=True)
freeze = subprocess.check_output([str(venv / 'bin/pip'), 'freeze'], text=True)
(release / 'installed-requirements.txt').write_text(freeze)
unit = '''[Unit]
Description=ChainLab Research Toolbench (Newman)
After=network-online.target chainlab-api.service
Wants=network-online.target
[Service]
User=chainlab-tools
Group=chainlab-tools
WorkingDirectory=/var/lib/chainlab-toolbench
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=HOME=/var/lib/chainlab-toolbench
Environment=PATH=/opt/chainlab-toolbench/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=NEWMAN_USER_DATA_DIR=/var/lib/chainlab-toolbench
Environment=NEWMAN_RESOURCE_DIR=/opt/chainlab-toolbench/current
Environment=PYTHONPATH=/opt/chainlab-toolbench/current
Environment=CHAINLAB_ORIGIN=https://nn.rftf.cc.cd
EnvironmentFile=/etc/chainlab/deepseek.env
EnvironmentFile=/etc/chainlab/toolbench-kb.env
ExecStart=/opt/chainlab-toolbench/venv/bin/python -m uvicorn chainlab_app:app --host 127.0.0.1 --port 8790 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=5
UMask=0077
MemoryMax=700M
TasksMax=180
CPUQuota=100%
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/chainlab-toolbench
InaccessiblePaths=/etc/chainlab /opt/chainlab /var/lib/chainlab
[Install]
WantedBy=multi-user.target
'''
Path('/etc/systemd/system/chainlab-toolbench.service').write_text(unit)
current = base / 'current'
old = current.resolve() if current.exists() else None
pending = base / 'next'
pending.unlink(missing_ok=True)
pending.symlink_to(release, target_is_directory=True)
pending.replace(current)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'restart', 'chainlab-api'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'chainlab-toolbench'], check=True)
subprocess.run(['systemctl', 'restart', 'chainlab-toolbench'], check=True)
try:
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8790/healthz', timeout=3) as response:
                assert json.load(response)['ok']
            break
        except (OSError, AssertionError):
            time.sleep(2)
    else:
        raise RuntimeError('Toolbench startup failed')
    site = Path('/etc/nginx/sites-available/chainlab-nn-rftf')
    original = site.read_text()
    backup = base / 'nginx-before-toolbench.conf'
    if not backup.exists():
        backup.write_text(original)
    if 'location ^~ /toolbench/' not in original:
        block = '''    location = /toolbench { return 302 /toolbench/; }
    location ^~ /toolbench/ {
        proxy_pass http://127.0.0.1:8790/;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 40m;
        add_header Cache-Control "no-store";
    }

'''
        site.write_text(original.replace('    location /api/ {', block + '    location /api/ {', 1))
        result = subprocess.run(['nginx', '-t'])
        if result.returncode:
            site.write_text(original)
            raise RuntimeError('Nginx validation failed; previous configuration restored')
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    if old:
        pending.symlink_to(old, target_is_directory=True)
        pending.replace(current)
        subprocess.run(['systemctl', 'restart', 'chainlab-toolbench'], check=False)
    else:
        subprocess.run(['systemctl', 'stop', 'chainlab-toolbench'], check=False)
    raise
print(json.dumps({'release': str(release), 'previous': str(old) if old else None, 'url': 'https://nn.rftf.cc.cd/toolbench/'}))
