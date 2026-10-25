"""Deploy an approved CHAINLAB release via SSH; never persist login credentials."""

import argparse
import getpass
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import paramiko


def remote(ssh, command, timeout=600):
    command = f'timeout --signal=TERM --kill-after=15s {timeout}s sh -c {shlex.quote(command)}'
    _, output, errors = ssh.exec_command(command, timeout=timeout)
    channel = output.channel
    deadline = time.monotonic() + timeout + 20
    while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
        if time.monotonic() > deadline:
            channel.close()
            raise TimeoutError('Remote deployment timed out; completion is unverified.')
        if channel.recv_ready():
            print(channel.recv(65536).decode('utf-8', errors='replace'), end='', flush=True)
        if channel.recv_stderr_ready():
            print(channel.recv_stderr(65536).decode('utf-8', errors='replace'), end='', flush=True)
        time.sleep(0.08)
    if channel.recv_exit_status() != 0:
        raise RuntimeError('Remote command failed; release was not verified.')


def upload(sftp, source, target):
    last = [0]
    def progress(done, total):
        if time.monotonic() - last[0] > 10 or done == total:
            print(f'{source.name}: {done:,}/{total:,} bytes', flush=True)
            last[0] = time.monotonic()
    sftp.put(str(source), target, callback=progress)


def parallel_upload(ssh, sftp, source, target, host, user, identity):
    """Resume independent byte ranges to avoid a single high-latency SFTP stream."""
    total = source.stat().st_size
    workers = 4
    width = (total + workers - 1) // workers
    prepare = f'''from pathlib import Path
import shutil
path=Path({target!r})
width={width}
if path.exists():
    length=path.stat().st_size
    for index in range({workers}):
        part=Path(str(path)+'.part'+str(index))
        count=max(0,min(width,length-index*width))
        if count and not part.exists():
            with path.open('rb') as source, part.open('wb') as output:
                source.seek(index*width)
                while count:
                    block=source.read(min(count,1048576))
                    output.write(block)
                    count-=len(block)
'''
    remote(ssh, 'python3 -c ' + shlex.quote(prepare))
    def part(index):
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        known = Path.home() / '.ssh/known_hosts'
        if known.exists(): client.load_host_keys(str(known))
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, username=user, key_filename=str(identity), timeout=30, allow_agent=False, look_for_keys=False)
        transfer = paramiko.SFTPClient.from_transport(client.get_transport(), window_size=16*1024*1024)
        name = target + '.part' + str(index)
        length = min(width, total - index * width)
        try:
            try: done = transfer.stat(name).st_size
            except FileNotFoundError: done = 0
            if done > length: raise RuntimeError('Unexpected partial upload length')
            last = time.monotonic()
            with source.open('rb') as local, transfer.open(name, 'ab') as output:
                output.set_pipelined(True)
                local.seek(index * width + done)
                while done < length:
                    block = local.read(min(131072, length - done))
                    output.write(block)
                    done += len(block)
                    if time.monotonic() - last > 15:
                        print(f'{source.name} [{index+1}/{workers}]: {done:,}/{length:,}', flush=True)
                        last = time.monotonic()
            return length
        finally:
            transfer.close()
            client.close()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        transferred = sum(pool.map(part, range(workers)))
    combine = f'''from pathlib import Path
import os, shutil
path=Path({target!r})
temporary=Path(str(path)+'.assembling')
with temporary.open('wb') as output:
    for index in range({workers}):
        with Path(str(path)+'.part'+str(index)).open('rb') as source:
            shutil.copyfileobj(source, output, 1048576)
assert temporary.stat().st_size=={total}
os.replace(temporary,path)
'''
    remote(ssh, 'python3 -c ' + shlex.quote(combine))
    print(f'Uploaded {source.name}: {transferred:,} bytes', flush=True)


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--user', default='root')
    parser.add_argument('--identity', type=Path)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--database', type=Path, default=root / 'var/mrio.sqlite3')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', args.domain):
        raise SystemExit('Invalid domain')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    release = manifest['release']
    if not re.fullmatch(r'\d{8}T\d{6}Z', release):
        raise SystemExit('Invalid release identity')
    archive = args.manifest.parent / manifest['archive']
    for path, expected in [(archive, manifest['sha256']), (args.database, manifest['database']['sha256'])]:
        digest = hashlib.sha256()
        with path.open('rb') as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise SystemExit(f'Local artifact changed: {path.name}')
    ssh = paramiko.SSHClient()
    known = Path.home() / '.ssh/known_hosts'
    if known.exists():
        ssh.load_host_keys(str(known))
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    auth = {'key_filename': str(args.identity)} if args.identity else {'password': getpass.getpass('SSH password: ')}
    try:
        ssh.connect(args.host, username=args.user, timeout=25, auth_timeout=25,
                    look_for_keys=not bool(auth), allow_agent=True, **auth)
        auth.clear()
        print(f'Authenticated: {args.user}@{args.host}', flush=True)
        remote(ssh, 'uname -s')
        destination = f'/opt/chainlab/releases/{release}'
        remote(ssh, f'mkdir -p {shlex.quote(destination + "/data")}')
        with ssh.open_sftp() as sftp:
            remote_archive = f'/tmp/chainlab-{release}.tar.gz'
            if args.identity:
                parallel_upload(ssh, sftp, archive, remote_archive, args.host, args.user, args.identity)
            else:
                upload(sftp, archive, remote_archive)
            pending = destination + '/data/mrio.sqlite3.pending'
            if args.identity:
                parallel_upload(ssh, sftp, args.database, pending, args.host, args.user, args.identity)
            else:
                upload(sftp, args.database, pending)
        verifier = f'''import hashlib, pathlib, tarfile, os, shutil
def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            result.update(block)
    return result.hexdigest()
archive = pathlib.Path({remote_archive!r})
pending = pathlib.Path({pending!r})
destination = pathlib.Path({destination!r})
assert digest(archive) == {manifest['sha256']!r}
assert digest(pending) == {manifest['database']['sha256']!r}
with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        name = pathlib.PurePosixPath(member.name)
        if not member.isfile() or name.is_absolute() or '..' in name.parts:
            raise ValueError('Unexpected archive entry')
        target = destination.joinpath(*name.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with bundle.extractfile(member) as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)
        target.chmod(0o644)
database = destination / 'data/mrio.sqlite3'
os.replace(pending, database)
print('Upload digests verified')
'''
        remote(ssh, f'python3 -c {shlex.quote(verifier)}')
        remote(ssh, f'bash {shlex.quote(destination + "/deploy/install.sh")} {shlex.quote(args.domain)}', timeout=900)
        print(json.dumps({'installed': args.domain, 'release': release, 'note': 'Verify from an ordinary public client before claiming public availability.'}))
    except paramiko.BadAuthenticationType as error:
        raise SystemExit(f'SSH rejected this authentication method (allowed: {", ".join(error.allowed_types)}). Use an authorized local key or enable password authentication in the server console.')
    finally:
        auth.clear()
        ssh.close()


if __name__ == '__main__':
    main()
