# Domain Migration

Requested hostname: `nn.fan-top.xyz`.
Expected A record: `64.90.13.22`.

On 2026-11-14, both Google and Cloudflare public resolvers returned NXDOMAIN
for the new hostname; the root domain's NS lookup also returned NXDOMAIN from
the `.xyz` authority. This does not establish the registrar account status.

The server's staging Nginx site is enabled at
`/etc/nginx/sites-available/chainlab-domain-pending`. It permits ACME validation
and returns an explicit 503 pending status elsewhere. Existing HTTPS, runtime
configuration, library data and toolbench Origin settings remain unchanged.
No new certificate has been issued yet.

After registration/delegation and the A record resolve, upload `change-domain.py`
and run on the deployment host:

```sh
/opt/chainlab-toolbench/venv/bin/python /tmp/chainlab-change-domain.py --domain nn.fan-top.xyz --activate
```

The command checks DNS, obtains the new certificate, updates the existing
Nginx site (retaining all API/library/toolbench routes), changes the persistent
toolbench CORS setting and systemd Origin override, and verifies HTTPS health.
It backs up changed configuration under `/var/backups/chainlab/domain-*` and
restores it if activation fails. The canonical site filename remains unchanged
so existing deployment scripts continue to manage the correct site.

After activation, run the public browser/login regression with
`TOOLBENCH_BASE=https://nn.fan-top.xyz`, confirm certificate renewal configuration,
and update repository default URLs to the activated hostname. Users need to log
in again because cookies are scoped to the previous hostname.
