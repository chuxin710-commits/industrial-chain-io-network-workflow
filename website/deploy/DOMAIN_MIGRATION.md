# Domain Migration

Requested hostname: `nn.fan-top.xyz`.
Expected A record: `64.90.13.22`.

## Active

Activated on 2026-11-14. Cloudflare public DNS resolves the hostname to
`64.90.13.22`; direct public HTTPS (without a DNS override) returns 200 for
the homepage and healthy responses from `/api/health` and `/toolbench/healthz`.
The new certificate expires on 2027-02-12 and `certbot.timer` is active.
Nginx, persistent toolbench CORS and the systemd Origin override now use the
new hostname. Configuration backup: `/var/backups/chainlab/domain-20261114T092145Z`.
Repository toolbench defaults have also been updated. Users must log in again
on the new hostname.

Public Playwright regression passed on the new hostname: group-account login,
tool and skill loading, both knowledge-base catalogs, live literature retrieval,
cited PDF-page opening, private endpoint access control, and homepage/toolbench
layouts at 1440, 390 and 320 pixels. No page errors or horizontal overflow were
reported. This run did not call the model generation endpoint.

The first activation attempt correctly rolled back when the immediate HTTPS
check encountered an old Nginx worker's certificate during reload. The check
now retries all transient errors within a bounded window, without disabling
certificate validation. The second activation succeeded.

## Earlier DNS Investigation

On 2026-11-14, both Google and Cloudflare public resolvers returned NXDOMAIN
for the new hostname; the root domain's NS lookup also returned NXDOMAIN from
the `.xyz` authority. This does not establish the registrar account status.

Follow-up evidence on the same date: registry RDAP confirms registration at
05:24:42 UTC (13:24:42 Asia/Shanghai) and nameservers `ns1.dnsowl.com`,
`ns2.dnsowl.com`, `ns3.dnsowl.com`. A direct TCP DNS query to `ns1.dnsowl.com`
returns the correct authoritative A record `nn.fan-top.xyz -> 64.90.13.22`.
A direct TCP query to the parent authority `x.nic.xyz` still returns NXDOMAIN.
The user's A record is correct; the remaining blocker is parent-zone delegation
publication, not a missing registrar-side record. Recheck before activation.

Before activation, the server's staging Nginx site was enabled at
`/etc/nginx/sites-available/chainlab-domain-pending`. It permits ACME validation
and returned an explicit 503 pending status elsewhere. Existing HTTPS, runtime
configuration, library data and toolbench Origin settings were left unchanged
until the new certificate was issued. The staging site is now disabled.

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
