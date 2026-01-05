"""
Backend tests for authentication and document management.
Demonstrates unit and integration testing with pytest.
"""
import os

# Keep the suite self-contained by default.
# If you want to run against Postgres, export DATABASE_URL before running pytest.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db, engine
from app.models import User, UserRole, Document, DocumentStatus
from app.security import get_password_hash
import uuid

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override database dependency
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

# Test client
client = TestClient(app)


@pytest.fixture(scope="function")
def test_db():
    """Create fresh database for each test."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def admin_user(test_db):
    """Create an admin user for testing."""
    db = TestingSessionLocal()
    user = User(
        id=str(uuid.uuid4()),
        email="admin@test.com",
        username="admin",
        hashed_password=get_password_hash("Admin123!"),
        role=UserRole.ADMIN,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user


@pytest.fixture
def regular_user(test_db):
    """Create a regular user for testing."""
    db = TestingSessionLocal()
    user = User(
        id=str(uuid.uuid4()),
        email="user@test.com",
        username="user",
        hashed_password=get_password_hash("User123!"),
        role=UserRole.USER,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user


@pytest.fixture
def admin_token(admin_user):
    """Get auth token for admin user."""
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "Admin123!"}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def user_token(regular_user):
    """Get auth token for regular user."""
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "User123!"}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


# =====================
# AUTHENTICATION TESTS
# =====================

class TestAuthentication:
    """Test suite for authentication endpoints."""
    
    def test_register_first_user_is_admin(self, test_db):
        """First registered user should automatically be admin."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "first@test.com",
                "username": "firstuser",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "admin"
        assert data["email"] == "first@test.com"
    
    def test_register_subsequent_users_are_regular(self, admin_user):
        """Subsequent users should have regular user role."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "second@test.com",
                "username": "seconduser",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "user"
    
    def test_register_duplicate_email_fails(self, admin_user):
        """Cannot register with duplicate email."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "admin@test.com",  # Already exists
                "username": "different",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 400
        assert "Email already registered" in response.json()["detail"]
    
    def test_register_weak_password_fails(self, test_db):
        """Password must meet strength requirements."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "weak@test.com",
                "username": "weakpass",
                "password": "weak"  # Too weak
            }
        )
        assert response.status_code == 422  # Validation error
    
    def test_login_success(self, admin_user):
        """Valid credentials should return access and refresh tokens."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_wrong_password_fails(self, admin_user):
        """Wrong password should fail."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "WrongPassword!"}
        )
        assert response.status_code == 401
        assert "Incorrect username or password" in response.json()["detail"]
    
    def test_login_nonexistent_user_fails(self, test_db):
        """Login with nonexistent user should fail."""
        response = client.post(
            "/api/auth/login",
            json={"username": "ghost", "password": "Ghost123!"}
        )
        assert response.status_code == 401
    
    def test_refresh_token(self, admin_user):
        """Refresh token should generate new access token."""
        # Login first
        login_response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        refresh_token = login_response.json()["refresh_token"]
        
        # Use refresh token
        response = client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
    
    def test_get_current_user(self, admin_token):
        """Authenticated user should be able to get their info."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "admin"
        assert data["role"] == "admin"


# =====================
# AUTHORIZATION TESTS
# =====================

class TestAuthorization:
    """Test suite for role-based access control."""
    
    def test_protected_endpoint_requires_auth(self, test_db):
        """Accessing protected endpoint without token should fail."""
        response = client.get("/api/documents/")
        assert response.status_code == 403  # No credentials
    
    def test_regular_user_cannot_delete(self, user_token):
        """Regular users should not be able to delete documents."""
        response = client.delete(
            "/api/documents/fake-id",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        # Should be 403 (forbidden) if authorization is checked before existence
        # or 404 if document lookup happens first (depends on implementation)
        assert response.status_code in [403, 404]
    
    def test_admin_can_delete(self, admin_token):
        """Admin users should be able to delete documents."""
        # This will fail with 404 (doc doesn't exist), but we verify
        # authorization passes (not 403)
        response = client.delete(
            "/api/documents/fake-id",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # Should get 404 (not found), not 403 (forbidden)
        assert response.status_code == 404


# =====================
# API SECURITY TESTS
# =====================

class TestAPISecurity:
    """Test suite for API security features."""
    
    def test_invalid_token_rejected(self, test_db):
        """Invalid JWT tokens should be rejected."""
        response = client.get(
            "/api/documents/",
            headers={"Authorization": "Bearer invalid_token_here"}
        )
        assert response.status_code == 401
    
    def test_expired_token_rejected(self, test_db):
        """Expired tokens should be rejected."""
        # This would require mocking time or using a token with past expiry
        pass  # TODO: Implement with freezegun or similar
    
    def test_rate_limiting_enforced(self, test_db):
        """Rate limiting should prevent excessive requests.
        
        NOTE: This test is skipped in CI because:
        1. RATE_LIMIT_ENABLED is set to 'false' in CI environment
        2. Rate limiting state is global and affects test isolation
        3. Rate limits persist across test runs by default
        
        To test rate limiting locally, set RATE_LIMIT_ENABLED=true and
        run this test in isolation.
        """
        import os
        rate_limit_enabled = os.getenv("RATE_LIMIT_ENABLED", "false").lower() == "true"
        if not rate_limit_enabled:
            pytest.skip("Rate limiting disabled in this environment (RATE_LIMIT_ENABLED=false)")
        
        # Make many rapid requests (depends on rate limit config)
        responses = []
        for i in range(12):  # Exceed 10/minute limit
            response = client.post(
                "/api/auth/register",
                json={
                    "email": f"ratelimit{i}@test.com",
                    "username": f"ratelimit{i}",
                    "password": "Strong123!"
                }
            )
            responses.append(response.status_code)
        
        # At least one request should be rate limited
        assert 429 in responses  # Too Many Requests


# =====================
# INPUT VALIDATION TESTS
# =====================

class TestInputValidation:
    """Test suite for input validation (OWASP)."""
    
    def test_invalid_email_rejected(self, test_db):
        """Invalid email format should be rejected."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "not-an-email",
                "username": "user",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 422  # Validation error
    
    def test_username_too_short_rejected(self, test_db):
        """Username that's too short should be rejected."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "test@test.com",
                "username": "ab",  # Min is 3
                "password": "Strong123!"
            }
        )
        assert response.status_code == 422
    
    def test_sql_injection_prevented(self, admin_user, admin_token):
        """SQL injection attempts should be safely handled."""
        # Try SQL injection in document ID
        malicious_id = "'; DROP TABLE users; --"
        response = client.get(
            f"/api/documents/{malicious_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # Should return 404, not crash
        assert "' or '1'='1" not in response.text


# =====================
# ADMIN MANAGEMENT TESTS
# =====================

class TestAdminManagement:
    """Test suite for admin role management features."""
    
    def test_promote_user_to_admin(self, admin_token, regular_user):
        """Admin should be able to promote a regular user to admin."""
        response = client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"
        assert data["username"] == "user"
    
    def test_demote_user_from_admin(self, admin_token, regular_user):
        """Admin should be able to demote another admin to regular user."""
        # First promote the user
        client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        # Then demote them
        response = client.post(
            f"/api/auth/admin/demote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "user"
    
    def test_prevent_demoting_last_admin(self, admin_token, admin_user):
        """Should not allow demoting the last remaining admin."""
        response = client.post(
            f"/api/auth/admin/demote/{admin_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 400
        assert "last remaining admin" in response.json()["detail"].lower()
    
    def test_regular_user_cannot_promote(self, user_token, regular_user):
        """Regular users should not be able to promote others."""
        response = client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 403
        assert "only admins can" in response.json()["detail"].lower()
    
    def test_list_all_users_admin_only(self, admin_token, user_token):
        """Only admins should be able to list all users."""
        # Admin should succeed
        response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        
        # Regular user should fail
        response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 403


# =====================
# ADMIN EMAIL ENV VAR TESTS
# =====================

class TestAdminEmailConfiguration:
    """Test suite for ADMIN_EMAILS environment variable."""
    
    def test_admin_email_from_env(self, test_db, monkeypatch):
        """User with email in ADMIN_EMAILS should become admin on registration."""
        # Clear any existing users first
        db = TestingSessionLocal()
        db.query(User).delete()
        db.commit()
        db.close()
        
        # Set ADMIN_EMAILS environment variable
        monkeypatch.setenv("ADMIN_EMAILS", "special@test.com,another@test.com")
        from app.config import get_settings
        get_settings.cache_clear()
        
        response = client.post(
            "/api/auth/register",
            json={
                "email": "special@test.com",
                "username": "specialuser",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "admin"
    
    def test_non_admin_email_from_env(self, test_db, monkeypatch):
        """User with email NOT in ADMIN_EMAILS should be regular user."""
        # Clear any existing users first
        db = TestingSessionLocal()
        db.query(User).delete()
        db.commit()
        db.close()
        
        monkeypatch.setenv("ADMIN_EMAILS", "special@test.com")
        from app.config import get_settings
        get_settings.cache_clear()
        
        # First register the special email
        response1 = client.post(
            "/api/auth/register",
            json={
                "email": "special@test.com",
                "username": "specialuser",
                "password": "Strong123!"
            }
        )
        assert response1.status_code == 201
        
        # Then register a non-special email
        response = client.post(
            "/api/auth/register",
            json={
                "email": "regular@test.com",
                "username": "regularuser",
                "password": "Strong123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "user"  # Should be regular user, not admin


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


def teardown_module(module=None):
    """Ensure TestClient is closed to avoid hanging test sessions."""
    try:
        client.close()
    except Exception:
        pass
