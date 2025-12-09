# Security Guidelines

## Before Deploying to Production

### 🔐 Required Security Changes

1. **Change Secret Key**
   - Generate a secure random secret key (at least 32 characters)
   - Set `SECRET_KEY` in your `.env` file
   - Never commit the actual secret to version control

   ```bash
   # Generate a secure secret key
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. **Update Database Credentials**
   - Change default `POSTGRES_USER` and `POSTGRES_PASSWORD` in docker-compose files
   - Use strong, unique passwords
   - Update `DATABASE_URL` in `.env` accordingly

3. **Configure Authentication**
   - The current `/auth/token` endpoint accepts any credentials (line 417 in `app/main.py`)
   - **TODO**: Implement proper user authentication against database
   - Add user registration, password validation, and account management

4. **Environment Variables**
   - Copy `example.env` to `.env`
   - Fill in all production values
   - Never commit `.env` to git (already in `.gitignore`)

5. **CORS Configuration**
   - Update `allow_origins` in `app/main.py` to match your production domain
   - Remove `"*"` wildcard in production

6. **HTTPS/TLS**
   - Use HTTPS in production (configure reverse proxy like Nginx)
   - Update `FRONTEND_URL` to use `https://`

### 📋 Security Checklist

- [ ] Secret key changed from default
- [ ] Database credentials updated
- [ ] Authentication implemented
- [ ] `.env` file configured and NOT committed
- [ ] CORS origins restricted
- [ ] HTTPS configured
- [ ] File upload size limits reviewed
- [ ] Rate limiting configured (optional but recommended)
- [ ] Database backups configured
- [ ] Error messages don't leak sensitive info

### 🛡️ Current Security Features

- ✅ Password hashing with bcrypt (OWASP compliant)
- ✅ JWT token-based authentication
- ✅ Input validation with Pydantic
- ✅ SQL injection protection via SQLAlchemy ORM
- ✅ Non-root Docker container user
- ✅ Environment-based configuration

### ⚠️ Known Limitations

1. **Demo Authentication**: The login endpoint currently accepts any username/password
2. **Default Secrets**: Default values are placeholders only
3. **Local Storage**: Uploaded files stored locally (not cloud)

## Reporting Security Issues

If you discover a security vulnerability, please report it privately to the repository owner.
