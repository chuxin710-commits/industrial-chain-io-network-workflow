"""Stage ACME routing, then activate a domain only after DNS and TLS succeed."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--previous', default='nn.rftf.cc.cd')
    parser.add_argument('--ip', default='64.90.13.22')
    parser.add_argument('--activate', action='store_true')
    args = parser.parse_args()
    for domain in (args.domain, args.previous):
        if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', domain):
            raise SystemExit('Invalid hostname')
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    site = Path('/etc/nginx/sites-available/chainlab-nn-rftf')
    original = site.read_text()
    staging = Path('/etc/nginx/sites-available/chainlab-domain-pending')
    enabled = Path('/etc/nginx/sites-enabled/chainlab-domain-pending')
    backup = Path('/var/backups/chainlab') / ('domain-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(parents=True)
    shutil.copy2(site, backup / 'nginx.conf')
    if args.domain not in original:
        pending = f'''server {{
    listen 80;
    listen [::]:80;
    server_name {args.domain};
    location ^~ /.well-known/acme-challenge/ {{ root /var/www/chainlab-acme; }}
    location / {{ add_header Retry-After 900 always; return 503 "Domain configuration pending HTTPS activation.\\n"; }}
}}
'''
        staging.write_text(pending)
        if not enabled.exists():
            enabled.symlink_to(staging)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
    if not args.activate:
        print(json.dumps({'state': 'prepared', 'domain': args.domain, 'backup': str(backup)}))
        return
    try:
        ips = {item[4][0] for item in socket.getaddrinfo(args.domain, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror:
        raise SystemExit('DNS unresolved; ACME route staged, active website unchanged')
    if args.ip not in ips:
        raise SystemExit('DNS does not point to the deployment host; active website unchanged')
    run('certbot', 'certonly', '--webroot', '-w', '/var/www/chainlab-acme',
        '-d', args.domain, '--cert-name', args.domain, '--non-interactive',
        '--agree-tos', '--register-unsafely-without-email')
    cert = Path('/etc/letsencrypt/live') / args.domain / 'fullchain.pem'
    run('openssl', 'x509', '-in', str(cert), '-noout', '-checkhost', args.domain)
    run('openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '86400')
    import yaml
    config = Path('/var/lib/chainlab-toolbench/newman.yaml')
    dropin = Path('/etc/systemd/system/chainlab-toolbench.service.d/domain.conf')
    config_original = config.read_text()
    prior_dropin = dropin.read_text() if dropin.exists() else None
    (backup / 'newman.yaml').write_text(config_original)
    if prior_dropin is not None:
        (backup / 'domain.conf').write_text(prior_dropin)
    try:
        updated = original.replace(args.previous, args.domain)
        if f'server_name {args.domain};' not in updated:
            raise RuntimeError('Unexpected active Nginx config')
        site.write_text(updated)
        enabled.unlink(missing_ok=True)
        run('nginx', '-t')
        settings = yaml.safe_load(config_original)
        settings['server']['cors_origins'] = ['https://' + args.domain]
        config.write_text(yaml.safe_dump(settings, allow_unicode=True, sort_keys=False))
        dropin.parent.mkdir(exist_ok=True)
        dropin.write_text('[Service]\nEnvironment=CHAINLAB_ORIGIN=https://' + args.domain + '\n')
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', 'chainlab-toolbench')
        run('systemctl', 'reload', 'nginx')
        # Nginx reload returns before old workers finish handing over TLS traffic.
        run('curl', '--fail', '--silent', '--show-error', '--retry', '8', '--retry-all-errors',
            '--retry-delay', '2', '--max-time', '10', '--resolve', args.domain + ':443:127.0.0.1',
            'https://' + args.domain + '/toolbench/healthz')
        run('curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--resolve',
            args.domain + ':443:127.0.0.1', 'https://' + args.domain + '/api/health')
    except Exception:
        site.write_text(original)
        config.write_text(config_original)
        if prior_dropin is None:
            dropin.unlink(missing_ok=True)
        else:
            dropin.write_text(prior_dropin)
        if staging.exists() and args.domain not in original and not enabled.exists():
            enabled.symlink_to(staging)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', 'chainlab-toolbench')
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        raise
    print(json.dumps({'state': 'active', 'url': 'https://' + args.domain, 'backup': str(backup)}))


if __name__ == '__main__':
    main()
