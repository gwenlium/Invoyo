# Testing Guide

This document describes the test suites and how to run them locally.

## Test Files

### Backend Tests

#### `tests/test_backend.py`
Comprehensive backend authentication and security tests.

**Test Classes:**
- `TestAuthentication` — Registration, login, token refresh, user info
- `TestAuthorization` — Role-based access control (RBAC) and protected endpoints
- `TestAPISecurity` — JWT validation, token expiration, rate limiting
- `TestInputValidation` — Email/username validation, SQL injection prevention
- `TestAdminManagement` — User promotion/demotion, last admin protection
- `TestAdminEmailConfiguration` — ADMIN_EMAILS environment variable handling

**Run backend tests:**
```bash
pytest tests/test_backend.py -v
```

**Run specific test class:**
```bash
pytest tests/test_backend.py::TestAuthentication -v
```

### Frontend Integration Tests

#### `tests/test_frontend.py`
Integration tests simulating frontend component interactions with the backend API.

**Test Classes:**
- `TestAuthPages` — Register/login form submissions and responses
- `TestAdminPanel` — Admin panel user listing, promotion, demotion
- `TestDocumentListComponent` — Document list fetching and detail views
- `TestHeaderComponent` — Current user info, logout simulation
- `TestToastNotifications` — Response formats for success/error toasts
- `TestResponseFormats` — User, token, and error response structures
- `TestAuthGuardAndRouting` — Protected routes, auth guards, token refresh

**Run frontend integration tests:**
```bash
pytest tests/test_frontend.py -v
```

**Run specific test class:**
```bash
pytest tests/test_frontend.py::TestAdminPanel -v
```

## Running All Tests

### Locally (with PostgreSQL running)

**Prerequisites:**
```bash
# Install backend dependencies
pip install -r requirements.txt

# Start PostgreSQL (if using Docker)
docker run -d \
  --name postgres-test \
  -e POSTGRES_USER=testuser \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15
```

**Run all tests:**
```bash
# Set database URL
export DATABASE_URL=postgresql://testuser:testpass@localhost:5432/testdb

# Run all tests with coverage
pytest tests/ -v --cov=app --cov-report=html

# View coverage report
open htmlcov/index.html
```

**Run specific test file:**
```bash
pytest tests/test_backend.py -v
pytest tests/test_frontend.py -v
```

### Using Docker Compose

```bash
# Start services
docker compose -f docker-compose.dev.yml up

# In another terminal, run tests
docker compose -f docker-compose.dev.yml exec api pytest tests/ -v
```

## Docker Build Tests

### Bash (Linux/macOS)

```bash
./test-docker-build.sh

# With verbose output
VERBOSE=1 ./test-docker-build.sh
```

### PowerShell (Windows)

```powershell
.\test-docker-build.ps1

# With verbose output
.\test-docker-build.ps1 -Verbose
```

This script verifies that all Dockerfiles (backend, frontend, dev, prod) build successfully.

## CI/CD Pipeline

Tests are automatically run on:
- Push to `main`, `develop`, or `release/**` branches
- Pull requests to `main` or `develop` branches

**Pipeline stages:**
1. **backend-test** — Backend tests with coverage
2. **frontend-test** — Frontend build verification
3. **docker-build** — Docker image build and security scan (Trivy)
4. **security-audit** — Python/npm dependency vulnerability checks

Coverage reports are uploaded to Codecov.

## Writing New Tests

### Backend Test Template

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

class TestNewFeature:
    """Test suite for new feature."""
    
    def test_something(self, admin_token):
        """Test description."""
        response = client.get(
            "/some/endpoint",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        assert "expected_field" in response.json()
```

### Frontend Test Template

```python
class TestNewComponent:
    """Test suite for component interaction with API."""
    
    def test_component_action(self, admin_token):
        """Test that frontend action produces expected API call."""
        # Simulate frontend form submission
        response = client.post(
            "/api/endpoint",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"field": "value"}
        )
        # Verify response structure matches frontend expectations
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
```

## Fixtures

Common pytest fixtures are available:

- `test_db` — Fresh database for each test
- `admin_user` — Pre-created admin user
- `regular_user` — Pre-created regular user
- `admin_token` — Valid JWT token for admin
- `user_token` — Valid JWT token for regular user

## Environment Variables

For local testing, set these in your `.env` file:

```
DATABASE_URL=postgresql://testuser:testpass@localhost:5432/testdb
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=test-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
RATE_LIMIT_ENABLED=false
ADMIN_EMAILS=admin@example.com
```

## Troubleshooting

### Database Connection Error

```
sqlalchemy.exc.OperationalError: (psycopg2.OperationalError) connection refused
```

**Solution:** Ensure PostgreSQL is running and DATABASE_URL is correct.

### ModuleNotFoundError: No module named 'cv2'

**Solution:** Install missing dependencies:
```bash
pip install -r requirements.txt
```

### Tests timeout

Increase timeout in pytest:
```bash
pytest tests/ --timeout=60 -v
```

### Docker build fails

Check that all required files exist:
```bash
ls -la Dockerfile
ls -la client/Dockerfile
ls -la Dockerfile.dev
ls -la client/Dockerfile.dev
```

## Test Coverage Goals

- **Backend:** >80% coverage (core business logic)
- **Frontend:** >60% coverage (integration points)
- **Overall:** >70% combined coverage

Current coverage is tracked in Codecov and reported on every PR.
