"""Temporary authenticated deployment session. Credentials only enter via getpass."""

import argparse
import base64
import getpass
import hashlib
import json
from pathlib import Path
import sys
import time

import paramiko


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', default='root')
    parser.add_argument('--identity', type=Path)
    args = parser.parse_args()
    ssh = paramiko.SSHClient()
    known = Path.home() / '.ssh' / 'known_hosts'
    if known.exists():
        ssh.load_host_keys(str(known))
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    auth = {'key_filename': str(args.identity)} if args.identity else {'password': getpass.getpass('SSH password: ')}
    try:
        ssh.connect(args.host, username=args.user, timeout=25, auth_timeout=25,
                    banner_timeout=25, allow_agent=True, look_for_keys=False, **auth)
    except paramiko.BadAuthenticationType as error:
        auth.clear()
        ssh.close()
        raise SystemExit('SSH authentication method not allowed: ' + ', '.join(error.allowed_types))
    auth.clear()
    fingerprint = base64.b64encode(hashlib.sha256(ssh.get_transport().get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
    print(json.dumps({'connected': args.host, 'host_key_sha256': fingerprint}), flush=True)
    sftp = ssh.open_sftp()
    try:
        for line in sys.stdin:
            try:
                action = json.loads(line)
                if action['type'] == 'close':
                    break
                if action['type'] == 'put':
                    local, remote = action['local'], action['remote']
                    last = [0]
                    def progress(done, total):
                        if time.monotonic() - last[0] > 8 or done == total:
                            print(json.dumps({'upload': Path(local).name, 'bytes': done, 'total': total}), flush=True)
                            last[0] = time.monotonic()
                    sftp.put(local, remote, callback=progress)
                    print(json.dumps({'uploaded': remote}), flush=True)
                elif action['type'] == 'exec':
                    _, stdout, stderr = ssh.exec_command(action['command'], timeout=action.get('timeout', 180))
                    channel = stdout.channel
                    while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
                        if channel.recv_ready():
                            print(channel.recv(65536).decode('utf-8', errors='replace'), end='', flush=True)
                        if channel.recv_stderr_ready():
                            print(channel.recv_stderr(65536).decode('utf-8', errors='replace'), end='', flush=True)
                        time.sleep(0.08)
                    print(json.dumps({'exit_code': channel.recv_exit_status()}), flush=True)
                else:
                    raise ValueError('Unsupported action')
            except Exception as error:
                print(json.dumps({'error': str(error)}), flush=True)
    finally:
        sftp.close()
        ssh.close()


if __name__ == '__main__':
    main()
