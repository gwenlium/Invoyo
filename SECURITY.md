# Security

Minimal guidance for running Invoyo safely in production.

## What’s Built In
- JWT auth (access + refresh), RBAC, rate limiting
- Password hashing: PBKDF2‑SHA256 via Passlib (OWASP‑aligned)
- Input validation (Pydantic) and SQLAlchemy ORM
- Structured/audit logging for auth events

## Required Before Production
- Secrets: set a strong `SECRET_KEY` and rotate on compromise
- Env: copy `example.env` → `.env`, fill DB/Redis/paths; never commit `.env`
- DB/Redis: use managed services; strong credentials; least‑privileged access
- HTTPS: terminate TLS at a reverse proxy (e.g., Nginx) and enforce HSTS
- CORS: restrict allowed origins to your domains only
- Storage: persist `UPLOAD_DIRECTORY` with a volume; set backups and retention
- Tokens: pick sensible TTLs; protect refresh tokens; log and monitor auth failures

Quick secret generation
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## Configuration (essentials)
- `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- `DATABASE_URL`, `REDIS_URL`, `CELERY_*`
- `UPLOAD_DIRECTORY`, `MAX_UPLOAD_SIZE_MB`
- `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `LOG_LEVEL`

## Operational Checklist
- [ ] Strong `SECRET_KEY` configured; secrets stored out of VCS
- [ ] DB/Redis credentials rotated and not defaults
- [ ] CORS locked to prod domains; HTTPS enforced
- [ ] Uploads persisted and backed up; quotas applied
- [ ] Rate limits enabled; logs shipped/monitored
- [ ] Error responses avoid leaking internals

## Notes & Limitations
- Default `.env` values are for development only
- Files are stored on local disk by default; use durable storage in prod
- Client stores access tokens in browser storage; consider hardening session policy

## Report Issues
Please report vulnerabilities privately to the maintainer/owner. Do not open public issues with exploit details.
