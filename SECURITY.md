# Security Policy

## Supported versions

Only the latest release is supported with security updates.

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately via
GitHub's security advisory feature. Do not open a public issue.

## Security model

Herdr Remote runs as a personal service on `127.0.0.1`. Tailscale Serve
exposes it to your personal tailnet. There is no application-level
authentication — anyone who can reach the service can read sessions and
call mutating routes.

See `docs/SECURITY_MODEL.md` for the full trust boundary and HTTP surface.