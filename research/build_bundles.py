"""Build standalone case ZIPs from a narrow allowlist, never from run outputs."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
CASES = ("structure_resilience", "critical_sectors")


def build(case, output):
    target = output / f"{case}-research-v1.zip"
    files = [ROOT / "README.md", ROOT / "DATA_CONTRACT.md", ROOT / "run_case.py",
             ROOT / "requirements.txt"]
    files += sorted(p for p in (ROOT / case).glob("*") if p.suffix in (".py", ".md"))
    files += sorted(p for p in (ROOT / case / "published").glob("*") if p.suffix in (".csv", ".json"))
    files += sorted((ROOT / case / "figures").glob("*.png"))
    inventory = {"LICENSE": hashlib.sha256((ROOT.parent / "LICENSE").read_bytes()).hexdigest()}
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(ROOT.parent / "LICENSE", "LICENSE")
        for path in files:
            name = path.relative_to(ROOT.parent).as_posix()
            archive.write(path, name)
            inventory[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        archive.writestr("BUNDLE.json", json.dumps(dict(case=case, files_sha256=inventory,
            install="python -m pip install -r research/requirements.txt",
            run=f"python research/run_case.py {case} --synthetic --output outputs/demo-01",
            raw_data_included=False), indent=2))
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, digest in inventory.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "dist" / "research")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    hashes = []
    for case in CASES:
        target = build(case, args.output)
        hashes.append(f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {target.name}")
        print(target)
    (args.output / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="ascii")


if __name__ == "__main__":
    main()
