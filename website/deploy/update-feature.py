"""Install a verified code increment while reusing immutable media and data."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--domain', required=True)
    args = parser.parse_args()
    receipt = json.loads(args.manifest.read_text())
    if receipt.get('kind') != 'feature_increment' or not re.fullmatch(r'\d{8}T\d{6}Z', receipt['release']):
        raise SystemExit('Invalid feature release')
    if digest(args.archive) != receipt['sha256']:
        raise SystemExit('Archive checksum mismatch')
    lock = Path('/run/lock/chainlab-deploy.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    base = Path('/opt/chainlab/current').resolve(strict=True)
    releases = Path('/opt/chainlab/releases').resolve()
    if base.parent != releases:
        raise SystemExit('Unexpected base directory')
    target = releases / receipt['release']
    if target.exists():
        raise SystemExit('Release already exists; inspect it before retrying')
    expected = {item['path']: item for item in receipt['files']}
    with tarfile.open(args.archive, 'r:gz') as archive:
        members = archive.getmembers()
        if len(members) != len(expected) or {m.name for m in members} != set(expected):
            raise SystemExit('Archive does not match manifest')
        for member in members:
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or path.parts[0] not in ('public', 'server', 'deploy'):
                raise SystemExit('Unsupported release member')
            with archive.extractfile(member) as handle:
                data = handle.read()
            if len(data) != expected[member.name]['bytes'] or hashlib.sha256(data).hexdigest() != expected[member.name]['sha256']:
                raise SystemExit('Release member checksum mismatch')
        shutil.copytree(base, target, copy_function=os.link, symlinks=True)
        for member in members:
            destination = target / member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.feature-next')
            with archive.extractfile(member) as handle, temporary.open('wb') as output:
                shutil.copyfileobj(handle, output)
            temporary.chmod(0o644)
            os.replace(temporary, destination)
    previous = json.loads((base / 'release-manifest.json').read_text())
    previous['base_release'] = str(base)
    previous['release'] = receipt['release']
    previous['feature_archive_sha256'] = receipt['sha256']
    merged = {item['path']: item for item in previous.get('files', [])}
    merged.update(expected)
    previous['files'] = list(merged.values())
    output = target / 'release-manifest.next.json'
    output.write_text(json.dumps(previous, ensure_ascii=False, indent=2))
    os.replace(output, target / 'release-manifest.json')
    # The installer owns the same lock while preparing runtime and switching services.
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
    subprocess.run(['bash', str(target / 'deploy/install.sh'), args.domain], check=True)
    print(json.dumps({'active_release': str(target), 'database_reused': True, 'media_reused': True}))


if __name__ == '__main__':
    main()
