# Caddy + Cloudflare VPS deployment

This runbook covers the production public HTTPS path for MarketDesk:

```text
Domain registrar / hosting provider
  -> Cloudflare DNS zone
  -> A / AAAA records for the MarketDesk domain
  -> Caddy on the VPS terminates HTTPS
  -> Docker Compose app bound to localhost:3000
  -> MarketDesk API + SPA
```

The current Compose stack exposes the `app` service only on the host loopback address:

```yaml
ports:
  - '127.0.0.1:${APP_PORT:-3000}:3000'
```

Keep that shape for production. Caddy should be the only public HTTP/HTTPS entrypoint; PostgreSQL, Redis, and the app port should not be exposed directly to the internet.

## Prerequisites

- A Linux VPS with SSH access and sudo privileges.
- The production domain is owned at a registrar or hosting provider.
- The domain is added to Cloudflare and its authoritative nameservers are delegated to Cloudflare.
- Cloudflare DNS has an `A` record for the hostname pointing to the VPS IPv4 address and, if used, an `AAAA` record pointing to the VPS IPv6 address.
- Inbound firewall/security-group rules allow:
  - `80/tcp` for ACME HTTP-01 validation and HTTP redirects;
  - `443/tcp` for public HTTPS traffic.
- Docker and Docker Compose are installed on the VPS.
- MarketDesk is running locally on the VPS and responds on `http://127.0.0.1:3000` or the configured `APP_PORT`.
- Production `.env` has a public origin configured, for example:

```env
NODE_ENV=production
APP_PORT=3000
CORS_ORIGIN=https://marketdesk.example.com
# The bundled Compose PostgreSQL service is plaintext on the private Docker network.
DB_SSL_MODE=disable
```

`DB_SSL_MODE` is mandatory in production. Keep `disable` for the internal Compose
PostgreSQL service shown in this runbook. For an external managed PostgreSQL endpoint,
set `DB_SSL_MODE=verify-full`; MarketDesk then enables TLS with server-certificate
verification (`rejectUnauthorized: true`). Modes that enable TLS without certificate
verification are intentionally unsupported. `DB_SSL_MODE` is authoritative; TLS query
parameters in `DATABASE_URL` are ignored so they cannot silently weaken this setting.
For an external endpoint, also set its full `DATABASE_URL`; Compose preserves that value.
When `DATABASE_URL` is empty, Compose targets the bundled `postgres` service explicitly;
this intentionally overrides the copied `.env` value `DB_HOST=localhost`, which remains
the correct default only for running the backend natively outside Docker.
Database TLS is independent of the public Caddy/Cloudflare HTTPS configuration described
below.

- Before production changes, create and verify a backup of live state:
  - PostgreSQL dump or volume backup;
  - Redis data if it contains operational queue/checkpoint state that must survive rollback;
  - `uploads/` directory;
  - existing `/etc/caddy/` configuration.

## Cloudflare DNS and TLS settings

### DNS records

Use one hostname as canonical, for example `marketdesk.example.com` or the apex `example.com`.

| Name         | Type    | Value                        | Proxy status        |
| ------------ | ------- | ---------------------------- | ------------------- |
| `marketdesk` | `A`     | VPS IPv4 address             | DNS only or Proxied |
| `marketdesk` | `AAAA`  | VPS IPv6 address, if enabled | DNS only or Proxied |
| `www`        | `CNAME` | canonical hostname           | DNS only or Proxied |

Recommended rollout:

1. Start with **DNS only** while issuing the first Caddy certificate and verifying the origin path.
2. After HTTPS works directly, switch to **Proxied** if Cloudflare WAF/cache/DDOS features are desired.
3. Keep API and app routes uncached unless a route is explicitly safe to cache.

### SSL/TLS mode

Use **Full (strict)** in Cloudflare SSL/TLS settings once Caddy has a valid certificate. Avoid **Flexible** mode for this app because it makes Cloudflare connect to the VPS over plain HTTP and can cause redirect loops or misleading HTTPS behavior.

If Cloudflare is proxied and Caddy uses public Let's Encrypt certificates, ensure Cloudflare can reach the VPS on ports 80 and 443 during certificate issuance/renewal. If using Cloudflare Origin Certificates instead, install that origin certificate/key in Caddy deliberately and keep the key out of git.

### Redirect and cache notes

- Pick one canonical host and redirect the other host to it in Caddy.
- Do not enable a broad Cloudflare cache rule for `/api/*`, `/health`, `/ready`, OAuth callbacks, auth routes, or user-specific pages.
- If using WAF rules, allow expected marketplace OAuth callbacks and normal authenticated API requests.
- If the app sends absolute URLs or enforces CORS, align `CORS_ORIGIN`, callback URLs, and OAuth redirect URIs with the public canonical HTTPS origin.

## Install Caddy on Ubuntu/Debian

Run as a sudo-capable user on the VPS:

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
sudo systemctl enable --now caddy
```

Verify:

```bash
caddy version
systemctl status caddy --no-pager
```

## Recommended Caddyfile

Replace `marketdesk.example.com` with the production hostname and adjust `127.0.0.1:3000` only if `APP_PORT` differs.

```caddyfile
{
	# Keep the default Let's Encrypt issuer unless production policy requires otherwise.
	email ops@example.com
}

www.marketdesk.example.com {
	redir https://marketdesk.example.com{uri} permanent
}

marketdesk.example.com {
	encode zstd gzip

	# Useful security baseline. Keep CSP in the app if it needs route-specific tuning.
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	# Health endpoints are proxied to the app for external monitoring.
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-For {remote_host}
		transport http {
			read_timeout 60s
			write_timeout 60s
			dial_timeout 10s
		}
	}

	log {
		output file /var/log/caddy/marketdesk-access.log {
			roll_size 100mb
			roll_keep 5
			roll_keep_for 720h
		}
		format json
	}
}
```

Apply safely:

```bash
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -m 0644 Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If the app needs larger upload bodies, add a route-level guard before `reverse_proxy`, for example:

```caddyfile
request_body {
	max_size 25MB
}
```

Only raise limits to a documented product need.

## Verification checklist

Run these checks from the VPS:

```bash
# App local health through the loopback-bound Compose port
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready

# DNS points at this VPS
getent ahosts marketdesk.example.com

# Caddy config is valid and loaded
sudo caddy validate --config /etc/caddy/Caddyfile
systemctl is-active caddy
journalctl -u caddy -n 100 --no-pager

# Public HTTPS path through Caddy
curl -fsSI https://marketdesk.example.com/
curl -fsS https://marketdesk.example.com/health
curl -fsS https://marketdesk.example.com/ready
```

Run from a machine outside the VPS network as well:

```bash
curl -fsSI https://marketdesk.example.com/
curl -fsS https://marketdesk.example.com/health
```

Confirm in a browser:

- the frontend loads over HTTPS;
- login/API calls target the same HTTPS origin;
- no mixed-content warnings appear;
- OAuth callback URLs, if enabled, use the public HTTPS hostname;
- Caddy and app logs show no repeated 4xx/5xx errors.

## Rollback

1. Restore the previous Caddyfile backup:

```bash
sudo cp /etc/caddy/Caddyfile.backup.YYYYMMDDTHHMMSSZ /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

2. If DNS was changed, revert the Cloudflare record value/proxy mode and wait for propagation.
3. If the app `.env` was changed, restore the previous file, recreate only the app container if needed, and re-check `/health` and `/ready`.
4. If a deploy changed data or migrations, restore from the verified database/uploads backup rather than guessing partial reversions.

## Troubleshooting

### Cloudflare 521 Web server is down

Cloudflare cannot connect to the VPS. Check:

```bash
sudo ss -ltnp | grep -E ':80|:443'
sudo ufw status verbose || true
systemctl status caddy --no-pager
journalctl -u caddy -n 100 --no-pager
```

Ensure the VPS provider firewall also allows `80/tcp` and `443/tcp`.

### Cloudflare 522 Connection timed out

The DNS record points to a host that does not respond quickly enough. Common causes:

- wrong `A`/`AAAA` record;
- provider firewall blocks Cloudflare IP ranges;
- Caddy is stopped or bound to a different interface;
- the VPS is overloaded.

Verify `curl -v http://VPS_IP` and `curl -vk https://VPS_IP` from outside when safe, and check Caddy/app CPU and memory.

### Cloudflare 525/526 TLS handshake or invalid certificate

- Use Cloudflare SSL/TLS mode **Full (strict)** only when Caddy has a valid public certificate or a trusted Cloudflare Origin Certificate.
- Check certificate issuance logs:

```bash
journalctl -u caddy -n 200 --no-pager | grep -iE 'certificate|acme|tls|error'
```

- Temporarily set the DNS record to **DNS only** and retry Caddy issuance if Cloudflare proxying interferes.

### Caddy cannot get a certificate

- Confirm `A`/`AAAA` records resolve to the VPS.
- Confirm ports 80 and 443 are reachable from the internet.
- Remove stale conflicting web servers, or move them off ports 80/443.
- Avoid testing issuance repeatedly after failures; Let's Encrypt rate limits apply.

### Wrong upstream port or app not healthy

Check Compose and local health:

```bash
docker compose ps
docker compose logs --tail=100 app
curl -v http://127.0.0.1:3000/health
curl -v http://127.0.0.1:3000/ready
```

If `APP_PORT` is not `3000`, update the Caddy upstream to match the host-bound port.

### DNS not propagated

Use multiple resolvers:

```bash
dig +short marketdesk.example.com A @1.1.1.1
dig +short marketdesk.example.com A @8.8.8.8
dig +short marketdesk.example.com AAAA @1.1.1.1
```

Also check that the domain's authoritative nameservers at the registrar are Cloudflare's nameservers.

### Mixed content, CORS, or allowed origin failures

- Set `CORS_ORIGIN=https://marketdesk.example.com` in production.
- Ensure frontend API calls use same-origin `/api/...` URLs or the public HTTPS origin.
- Update marketplace OAuth redirect URIs to the public HTTPS callback URL.
- Recreate the app container after `.env` changes and verify the container received the new values without printing secrets.

## Copy-paste Hermes Agent prompt

Use this prompt when asking Hermes Agent to configure the setup on a VPS:

```text
Configure MarketDesk public HTTPS access through Cloudflare DNS and Caddy on this VPS.

Target path: domain/registrar -> Cloudflare DNS -> Caddy reverse proxy on VPS -> MarketDesk Docker Compose app on localhost APP_PORT (default 3000).

Safety requirements:
- Start read-only. Inspect OS, public/private IPs, current listeners, Docker Compose services, app health, firewall/security-group hints, existing Caddy install, and current /etc/caddy/Caddyfile before changing anything.
- Treat live MarketDesk data as valuable. Before any restart/reload/rebuild or production file edit, create and verify backups for PostgreSQL, uploads, and existing Caddy config where applicable.
- Never print secrets. Redact .env values, tokens, passwords, OAuth client secrets, JWT secrets, and API keys.
- Do not require Cloudflare API access. Explain the exact DNS records and proxy/SSL settings needed. Only use Cloudflare API if credentials are explicitly provided for this task.

Implementation requirements:
- Install and enable Caddy on Ubuntu/Debian if it is missing.
- Keep the MarketDesk app bound to localhost; do not expose app, PostgreSQL, Redis, or Hermes API ports publicly.
- Write a MarketDesk Caddyfile for the provided production domain, reverse_proxying to 127.0.0.1:${APP_PORT:-3000}.
- Include a deliberate www-to-apex or apex-to-www redirect policy if both names are used.
- Validate with `sudo caddy fmt --overwrite /etc/caddy/Caddyfile` and `sudo caddy validate --config /etc/caddy/Caddyfile` before reload.
- Reload Caddy with `sudo systemctl reload caddy`; do not restart unrelated services unless needed and backed up.

Verification requirements:
- Verify local app health: `curl http://127.0.0.1:${APP_PORT:-3000}/health` and `/ready`.
- Verify DNS resolves to this VPS from public resolvers.
- Verify public HTTPS: frontend root, `/health`, and `/ready` through the production hostname.
- Check Caddy logs and app logs for fresh errors.
- If something fails, diagnose Cloudflare 521/522/525/526, firewall, DNS propagation, certificate issuance, and upstream-port issues before making more changes.

Report back:
- exact commands run;
- files changed and backup paths;
- DNS/Cloudflare settings the operator must confirm manually;
- verification results from local and public paths;
- rollback steps;
- any unresolved blockers.
```
