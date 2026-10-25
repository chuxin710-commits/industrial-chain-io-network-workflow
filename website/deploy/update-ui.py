"""Clone an installed release with hard links, replace UI files, atomically activate."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    lock = open('/run/lock/chainlab-deploy.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    manifest = json.loads(args.manifest.read_text())
    release = manifest['release']
    if not re.fullmatch(r'\d{8}T\d{6}Z', release):
        raise SystemExit('Invalid increment identity')
    current = Path('/opt/chainlab/current')
    base = current.resolve(strict=True)
    if base.parent != Path('/opt/chainlab/releases'):
        raise SystemExit('Unexpected active release')
    target = base.parent / release
    if target.exists():
        raise SystemExit('Increment already exists; refusing to overwrite')
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != manifest['sha256']:
        raise SystemExit('UI archive digest mismatch')
    entries = {item['path']: item for item in manifest['files']}
    # Copy metadata-bearing private files normally; keep large immutable data/media linked.
    shutil.copytree(base, target, copy_function=os.link, symlinks=True)
    with tarfile.open(args.archive) as bundle:
        for member in bundle.getmembers():
            name = PurePosixPath(member.name)
            if not member.isfile() or name.is_absolute() or '..' in name.parts or member.name not in entries:
                raise SystemExit('Unexpected UI archive entry')
            if name.parts[0] != 'public' and member.name != 'deploy/update-ui.py':
                raise SystemExit('UI increment may not change backend or database')
            payload = bundle.extractfile(member).read()
            if hashlib.sha256(payload).hexdigest() != entries[member.name]['sha256']:
                raise SystemExit('UI file digest mismatch')
            destination = target.joinpath(*name.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.next')
            temporary.write_bytes(payload)
            temporary.chmod(0o644)
            os.replace(temporary, destination)
    base_receipt = json.loads((base / 'release-manifest.json').read_text())
    files = {item['path']: item for item in base_receipt['files']}
    files.update(entries)
    receipt = {'release': release, 'base_release': base.name,
               'base_archive_sha256': base_receipt.get('sha256'),
               'ui_update_sha256': manifest['sha256'],
               'database': base_receipt['database'], 'files': list(files.values())}
    receipt_path = target / 'release-manifest.json'
    temporary = receipt_path.with_suffix('.next.json')
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    os.replace(temporary, receipt_path)
    pointer = Path('/opt/chainlab/current.next')
    if pointer.is_symlink():
        pointer.unlink()
    pointer.symlink_to(target, target_is_directory=True)
    os.replace(pointer, current)
    print(json.dumps({'active_release': str(target), 'base_release': str(base), 'database_reused': True}))


if __name__ == '__main__':
    main()
