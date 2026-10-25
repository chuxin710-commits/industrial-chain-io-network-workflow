#!/usr/bin/env bash
set -Eeuo pipefail

release="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
domain="${1:?Provide the domain}"
case "$release" in /opt/chainlab/releases/*) ;; *) printf 'Unexpected release directory\n' >&2; exit 1 ;; esac
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ && $EUID -eq 0 ]] || exit 1
[[ -f "$release/public/index.html" && -f "$release/server/app.py" && -f "$release/data/mrio.sqlite3" ]] || exit 1
exec 9>/run/lock/chainlab-deploy.lock
flock -n 9 || { printf 'Another CHAINLAB deployment is running\n' >&2; exit 1; }
command -v nginx >/dev/null || { apt-get update; apt-get install -y nginx; }
command -v python3 >/dev/null || apt-get install -y python3

requirements="$release/server/requirements.txt"
runtime="/opt/chainlab/runtimes/$(sha256sum "$requirements" | cut -c1-16)"
if [[ ! -f "$runtime/ready" ]]; then
    if ! python3 -m venv "$runtime"; then apt-get update; apt-get install -y python3-venv; python3 -m venv "$runtime"; fi
    "$runtime/bin/python" -m pip install -r "$requirements"
    "$runtime/bin/python" -m pip freeze > "$runtime/installed.txt"
    touch "$runtime/ready"
fi
ln -sfn "$runtime" "$release/runtime"
PYTHONPATH="$release/server/vendor" "$runtime/bin/python" -c 'from ionet import build_network; import numpy,networkx; print("Network runtime:",numpy.__version__,networkx.__version__)'

site=/etc/nginx/sites-available/chainlab-nn-rftf
enabled=/etc/nginx/sites-enabled/chainlab-nn-rftf
unit=/etc/systemd/system/chainlab-api.service
python3 "$release/deploy/preflight.py" "$domain" "$site"
previous="$(readlink -f /opt/chainlab/current || true)"
old_active="$(systemctl is-active chainlab-api 2>/dev/null || true)"
old_enabled="$(systemctl is-enabled chainlab-api 2>/dev/null || true)"
backup=/var/backups/chainlab/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled "$backup" /var/www/chainlab-acme /opt/chainlab
[[ ! -f "$site" ]] || cp -a "$site" "$backup/nginx.conf"
[[ ! -f "$unit" ]] || cp -a "$unit" "$backup/service.conf"
[[ ! -L "$enabled" ]] || cp -a "$enabled" "$backup/enabled-link"

rollback() {
    result=$?
    trap - ERR INT TERM
    set +e
    if [[ -n "$previous" ]]; then ln -sfn "$previous" /opt/chainlab/current; else unlink /opt/chainlab/current; fi
    if [[ -f "$backup/nginx.conf" ]]; then cp -a "$backup/nginx.conf" "$site"; else [[ ! -f "$site" ]] || unlink "$site"; fi
    if [[ -L "$backup/enabled-link" ]]; then cp -a --remove-destination "$backup/enabled-link" "$enabled"; else [[ ! -L "$enabled" ]] || unlink "$enabled"; fi
    if [[ -f "$backup/service.conf" ]]; then cp -a "$backup/service.conf" "$unit"; else systemctl disable --now chainlab-api; [[ ! -f "$unit" ]] || unlink "$unit"; fi
    systemctl daemon-reload
    if [[ "$old_enabled" == enabled ]]; then systemctl enable chainlab-api; else systemctl disable chainlab-api; fi
    if [[ "$old_active" == active ]]; then systemctl restart chainlab-api; else systemctl stop chainlab-api; fi
    nginx -t && systemctl reload nginx
    printf '\nDeployment rolled back. Backup: %s\n' "$backup" >&2
    exit "${result:-1}"
}
trap rollback ERR INT TERM

id chainlab >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin chainlab
install -d -m 0750 -o chainlab -g chainlab /var/lib/chainlab/library
chown chainlab:chainlab "$release/data/mrio.sqlite3"
chmod 0640 "$release/data/mrio.sqlite3"
chmod -R a+rX "$release/public" "$release/server"
ln -sfn "$release" /opt/chainlab/current
install -m 0644 "$release/deploy/chainlab-api.service" "$unit"
systemctl daemon-reload
systemctl enable chainlab-api
systemctl restart chainlab-api
for attempt in {1..30}; do
    if curl --max-time 2 --silent --fail http://127.0.0.1:8787/api/health >/dev/null; then break; fi
    sleep 1
done
curl --max-time 15 --silent --fail http://127.0.0.1:8787/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["year_count"]==24 and d["complete_year_coverage"]; print(d)'
curl --max-time 30 --silent --fail 'http://127.0.0.1:8787/api/topology?year=2023&level=sector' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["metrics"]["nodes"]==42; print("Topology API ready")'

# Keep an existing Certbot-managed HTTPS configuration on later releases.
if [[ ! -f "$site" ]]; then sed "s/__DOMAIN__/$domain/g" "$release/deploy/nginx.conf.template" > "$site"; fi
python3 "$release/deploy/configure-library-nginx.py" "$site"
ln -sfn "$site" "$enabled"
nginx -t
systemctl reload nginx
proxy_ready=0
for attempt in {1..20}; do
    if grep -q 'listen.*443' "$site"; then
        response="$(curl --max-time 5 --fail --silent --resolve "$domain:443:127.0.0.1" "https://$domain/api/health" || true)"
    else
        response="$(curl --max-time 5 --fail --silent -H "Host: $domain" http://127.0.0.1/api/health || true)"
    fi
    if printf '%s' "$response" | python3 -c 'import json,sys; assert json.load(sys.stdin)["year_count"]==24' 2>/dev/null; then proxy_ready=1; break; fi
    sleep 1
done
[[ "$proxy_ready" == 1 ]] || { printf 'Nginx proxy readiness failed\n' >&2; false; }
trap - ERR INT TERM
printf '\nCHAINLAB release activated: %s\n' "$release"

if ! grep -q 'listen.*443' "$site" && command -v certbot >/dev/null; then
    if certbot --nginx -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
        nginx -t
        curl --max-time 20 --fail --silent --resolve "$domain:443:127.0.0.1" "https://$domain/api/health"
        printf '\nHTTPS deployment ready: https://%s/\n' "$domain"
    else
        printf '\nTLS issuance pending; HTTP remains available.\n' >&2
    fi
fi
