"""Add a library request budget without replacing Certbot TLS configuration."""
from pathlib import Path
import sys

site=Path(sys.argv[1]);text=site.read_text()
if 'location ^~ /api/library/' not in text:
    marker='    location /api/ {'
    if text.count(marker)!=1:raise SystemExit('Expected exactly one existing API location')
    text=text.replace(marker,'''    location ^~ /api/library/ {
        limit_req zone=chainlab_library burst=80 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_read_timeout 60s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100k;
    }
'''+marker)
    text='limit_req_zone $binary_remote_addr zone=chainlab_library:10m rate=20r/s;\n'+text
if 'location ~ ^/assets/[^/]+\\.mjs$' not in text:
    marker='    location /assets/ {'
    if text.count(marker)!=1:raise SystemExit('Expected exactly one existing assets location')
    text=text.replace(marker,'''    location ~ ^/assets/[^/]+\\.mjs$ {
        types { text/javascript mjs; }
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff always;
    }
'''+marker)
site.write_text(text)
