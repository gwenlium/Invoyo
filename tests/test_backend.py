"""
Backend tests for authentication and document management.
Demonstrates unit and integration testing with pytest.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db
from app.models import User, UserRole, Document, DocumentStatus
from app.security import get_password_hash
import uuid
import os

# Use PostgreSQL for tests (to match production enum types)
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://testuser:testpass@localhost:5432/testdb"
)
engine = create_engine(SQLALCHEMY_DATABASE_URL)
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
        "/auth/login",
        json={"username": "admin", "password": "Admin123!"}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def user_token(regular_user):
    """Get auth token for regular user."""
    response = client.post(
        "/auth/login",
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
            "/auth/register",
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
            "/auth/register",
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
            "/auth/register",
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
            "/auth/register",
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
            "/auth/login",
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
            "/auth/login",
            json={"username": "admin", "password": "WrongPassword!"}
        )
        assert response.status_code == 401
        assert "Incorrect username or password" in response.json()["detail"]
    
    def test_login_nonexistent_user_fails(self, test_db):
        """Login with nonexistent user should fail."""
        response = client.post(
            "/auth/login",
            json={"username": "ghost", "password": "Ghost123!"}
        )
        assert response.status_code == 401
    
    def test_refresh_token(self, admin_user):
        """Refresh token should generate new access token."""
        # Login first
        login_response = client.post(
            "/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        refresh_token = login_response.json()["refresh_token"]
        
        # Use refresh token
        response = client.post(
            "/auth/refresh",
            json={"refresh_token": refresh_token}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
    
    def test_get_current_user(self, admin_token):
        """Authenticated user should be able to get their info."""
        response = client.get(
            "/auth/me",
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
        response = client.get("/documents/")
        assert response.status_code == 403  # No credentials
    
    def test_regular_user_cannot_delete(self, user_token):
        """Regular users should not be able to delete documents."""
        response = client.delete(
            "/documents/fake-id",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 403  # Forbidden
        assert "Insufficient permissions" in response.json()["detail"]
    
    def test_admin_can_delete(self, admin_token):
        """Admin users should be able to delete documents."""
        # This will fail with 404 (doc doesn't exist), but we verify
        # authorization passes (not 403)
        response = client.delete(
            "/documents/fake-id",
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
            "/documents/",
            headers={"Authorization": "Bearer invalid_token_here"}
        )
        assert response.status_code == 401
    
    def test_expired_token_rejected(self, test_db):
        """Expired tokens should be rejected."""
        # This would require mocking time or using a token with past expiry
        pass  # TODO: Implement with freezegun or similar
    
    def test_rate_limiting_enforced(self, test_db):
        """Rate limiting should prevent excessive requests."""
        # Make many rapid requests (depends on rate limit config)
        responses = []
        for i in range(12):  # Exceed 10/minute limit
            response = client.post(
                "/auth/register",
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
            "/auth/register",
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
            "/auth/register",
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
            f"/documents/{malicious_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # Should return 404, not crash
        assert response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
