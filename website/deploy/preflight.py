"""Refuse to shadow an existing domain owned by another Nginx site."""

from pathlib import Path
import re
import sys

domain, expected = sys.argv[1], Path(sys.argv[2]).resolve()
paths = [*Path('/etc/nginx/sites-enabled').glob('*'), *Path('/etc/nginx/conf.d').glob('*.conf')]
for path in paths:
    if not path.is_file() or path.resolve() == expected:
        continue
    text = re.sub(r'#[^\n]*', '', path.read_text())
    for group in re.findall(r'\bserver_name\s+([^;]+);', text):
        if domain in [name.strip('"\'') for name in group.split()]:
            raise SystemExit(f'Domain already configured by {path}; refusing to replace it.')
