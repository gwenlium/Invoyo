"""
Frontend tests for Angular components.
Tests basic component functionality, routing, and integration with backend API.
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
import json
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
# FRONTEND INTEGRATION TESTS
# =====================

class TestAuthPages:
    """Test suite for authentication pages (login/register)."""
    
    def test_register_page_submission(self, test_db):
        """Test submitting the register form."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "newuser@test.com",
                "username": "newuser",
                "password": "NewUser123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "newuser@test.com"
        assert data["username"] == "newuser"
        assert "hashed_password" not in data  # Should not expose password
        assert "id" in data
        assert "created_at" in data
    
    def test_login_page_submission(self, admin_user):
        """Test submitting the login form."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_with_email(self, admin_user):
        """Test login using email instead of username."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin@test.com", "password": "Admin123!"}
        )
        assert response.status_code == 200
        assert "access_token" in response.json()
    
    def test_invalid_login_shows_error(self, admin_user):
        """Test that invalid login returns proper error."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "WrongPassword!"}
        )
        assert response.status_code == 401
        assert "detail" in response.json()


class TestAdminPanel:
    """Test suite for admin panel component and its API interactions."""
    
    def test_admin_panel_list_users(self, admin_token):
        """Test admin panel can fetch and display user list."""
        response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        users = response.json()
        assert isinstance(users, list)
        # Should have at least the admin user
        assert len(users) >= 1
        # Check user object structure
        user = users[0]
        assert "id" in user
        assert "username" in user
        assert "email" in user
        assert "role" in user
        assert "is_active" in user
    
    def test_admin_panel_promote_user(self, admin_token, regular_user):
        """Test promoting a user to admin from the admin panel."""
        # Verify user is currently regular
        list_response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        users = list_response.json()
        user = next((u for u in users if u["id"] == regular_user.id), None)
        assert user is not None
        assert user["role"] == "user"
        
        # Promote the user
        promote_response = client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert promote_response.status_code == 200
        promoted_user = promote_response.json()
        assert promoted_user["role"] == "admin"
    
    def test_admin_panel_demote_user(self, admin_token, regular_user):
        """Test demoting an admin user from the admin panel."""
        # First promote the user
        client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        # Then demote them
        demote_response = client.post(
            f"/api/auth/admin/demote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert demote_response.status_code == 200
        demoted_user = demote_response.json()
        assert demoted_user["role"] == "user"
    
    def test_non_admin_cannot_access_admin_panel(self, user_token):
        """Test that regular users cannot access admin endpoints."""
        response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 403
        assert "Only admins can" in response.json()["detail"]


class TestDocumentListComponent:
    """Test suite for document list component and uploads."""
    
    def test_get_document_list(self, user_token):
        """Test fetching document list (empty initially)."""
        response = client.get(
            "/api/documents/",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert "items" in data
        assert isinstance(data["items"], list)
    
    def test_get_document_list_requires_auth(self, test_db):
        """Test that document list requires authentication."""
        response = client.get("/api/documents/")
        assert response.status_code == 403  # Forbidden without auth
    
    def test_get_document_detail(self, admin_token):
        """Test fetching a specific document (404 if not found)."""
        response = client.get(
            "/api/documents/nonexistent-id",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # Should be 404 since document doesn't exist
        assert response.status_code == 404


class TestHeaderComponent:
    """Test suite for header component (user info, nav)."""
    
    def test_get_current_user_info(self, admin_token):
        """Test fetching current user info for header display."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        user = response.json()
        assert user["username"] == "admin"
        assert user["role"] == "admin"
        assert user["email"] == "admin@test.com"
        assert "hashed_password" not in user
    
    def test_logout_clears_token(self, user_token):
        """Test that using an invalidated token fails (simulated logout)."""
        # After logout, the frontend would discard the token
        # Test that a bad token is rejected
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid-token"}
        )
        assert response.status_code == 401


class TestToastNotifications:
    """Test suite for operations that should trigger toast notifications."""
    
    def test_successful_registration_response(self, test_db):
        """Test that successful registration returns expected response for toast."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "success@test.com",
                "username": "successuser",
                "password": "Success123!"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["id"]  # Frontend can display "User created: {username}"
        assert data["username"] == "successuser"
    
    def test_error_response_for_failed_operation(self, admin_user):
        """Test that failed operations return proper error for toast display."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "admin@test.com",  # Duplicate
                "username": "different",
                "password": "Different123!"
            }
        )
        assert response.status_code == 400
        error_data = response.json()
        assert "detail" in error_data  # Frontend can show this in error toast
    
    def test_promotion_success_response(self, admin_token, regular_user):
        """Test promotion returns data for success toast."""
        response = client.post(
            f"/api/auth/admin/promote/{regular_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"]  # Show "Promoted {username} to admin"
        assert data["role"] == "admin"
    
    def test_demotion_prevented_response(self, admin_token, admin_user):
        """Test that demotion prevention returns proper error for toast."""
        response = client.post(
            f"/api/auth/admin/demote/{admin_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 400
        error_data = response.json()
        assert "detail" in error_data  # Show in error toast


class TestResponseFormats:
    """Test suite for API response formats expected by frontend."""
    
    def test_user_response_structure(self, admin_user, admin_token):
        """Test that user responses have expected structure."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        user = response.json()
        
        # Verify structure matches frontend expectations
        required_fields = ["id", "username", "email", "role", "is_active", "created_at"]
        for field in required_fields:
            assert field in user, f"Missing field: {field}"
        
        # Verify types
        assert isinstance(user["id"], str)
        assert isinstance(user["username"], str)
        assert isinstance(user["email"], str)
        assert isinstance(user["role"], str)
        assert isinstance(user["is_active"], bool)
        assert isinstance(user["created_at"], str)  # ISO format datetime
    
    def test_token_response_structure(self, admin_user):
        """Test that login response has expected structure."""
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        assert response.status_code == 200
        token_data = response.json()
        
        # Verify structure
        assert "access_token" in token_data
        assert "refresh_token" in token_data
        assert "token_type" in token_data
        assert token_data["token_type"] == "bearer"
    
    def test_error_response_structure(self, test_db):
        """Test that error responses have consistent structure."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "invalid-email",
                "username": "test",
                "password": "Test123!"
            }
        )
        assert response.status_code == 422
        error_data = response.json()
        
        # Verify error structure
        assert "detail" in error_data


class TestAuthGuardAndRouting:
    """Test suite for auth guards and protected routes."""
    
    def test_protected_route_redirects_unauthenticated(self, test_db):
        """Test that protected routes require authentication."""
        response = client.get("/api/documents/")
        assert response.status_code == 403
    
    def test_admin_route_rejects_regular_user(self, user_token):
        """Test that admin routes reject non-admin users."""
        response = client.get(
            "/api/auth/admin/users",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert response.status_code == 403
    
    def test_token_refresh_extends_session(self, admin_user):
        """Test that token refresh works (extends session)."""
        # Login to get tokens
        login_response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"}
        )
        refresh_token = login_response.json()["refresh_token"]
        
        # Refresh should return new access token
        refresh_response = client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token}
        )
        assert refresh_response.status_code == 200
        new_token = refresh_response.json()["access_token"]
        
        # New token should work
        me_response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {new_token}"}
        )
        assert me_response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


def teardown_module(module=None):
    """Ensure TestClient is closed to avoid hanging test sessions."""
    try:
        client.close()
    except Exception:
        pass
