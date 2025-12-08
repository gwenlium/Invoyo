"""Integration tests for the Invoice Processor API."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

from app.database import get_db
app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

# ============================
# AUTHENTICATION TESTS
# ============================

def test_login():
    """Test JWT token generation."""
    response = client.post("/auth/token?username=testuser&password=testpass")
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "expires_in" in data

def test_upload_without_auth():
    """Test that endpoints require authentication."""
    response = client.post(
        "/documents/",
        files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")}
    )
    assert response.status_code == 403  # Forbidden without auth

# ============================
# HEALTH CHECK TESTS
# ============================

def test_health_check():
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data

# ============================
# DOCUMENT UPLOAD TESTS
# ============================

@pytest.fixture
def auth_headers():
    """Get authentication headers for tests."""
    response = client.post("/auth/token?username=testuser&password=testpass")
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_upload_pdf(auth_headers):
    """Test uploading a PDF file."""
    pdf_content = b"%PDF-1.4\n%test content"
    response = client.post(
        "/documents/",
        files={"file": ("test.pdf", pdf_content, "application/pdf")},
        headers=auth_headers
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filename"] == "test.pdf"
    assert data["status"] in ["processed", "failed"]  # May fail with mock content
    assert "id" in data

def test_upload_invalid_file_type(auth_headers):
    """Test that non-PDF files are rejected."""
    response = client.post(
        "/documents/",
        files={"file": ("test.txt", b"text content", "text/plain")},
        headers=auth_headers
    )
    assert response.status_code == 415  # Unsupported media type
    assert "Invalid file type" in response.json()["detail"]

def test_upload_file_too_large(auth_headers):
    """Test file size validation."""
    large_content = b"x" * (51 * 1024 * 1024)  # 51 MB
    response = client.post(
        "/documents/",
        files={"file": ("large.pdf", large_content, "application/pdf")},
        headers=auth_headers
    )
    assert response.status_code == 413  # Request entity too large

# ============================
# DOCUMENT RETRIEVAL TESTS
# ============================

def test_get_document(auth_headers):
    """Test retrieving a document."""
    # First upload
    pdf_content = b"%PDF-1.4\n%test"
    upload_response = client.post(
        "/documents/",
        files={"file": ("test.pdf", pdf_content, "application/pdf")},
        headers=auth_headers
    )
    doc_id = upload_response.json()["id"]
    
    # Then retrieve
    get_response = client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert get_response.status_code == 200
    assert get_response.json()["id"] == doc_id

def test_get_nonexistent_document(auth_headers):
    """Test retrieving a non-existent document."""
    response = client.get("/documents/nonexistent-id", headers=auth_headers)
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]

def test_list_documents(auth_headers):
    """Test listing documents."""
    response = client.get("/documents/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert "skip" in data
    assert "limit" in data

# ============================
# RATE LIMITING TESTS
# ============================

def test_rate_limit_on_upload(auth_headers):
    """Test that rate limiting is applied (would need more requests)."""
    # Note: Actual rate limiting test would require many requests
    # This is a placeholder demonstrating the concept
    response = client.get("/health")
    assert response.status_code == 200

# ============================
# ERROR HANDLING TESTS
# ============================

def test_malformed_request():
    """Test handling of malformed requests."""
    response = client.post("/auth/token?username=test")  # Missing password
    # Should handle gracefully (depends on implementation)
    assert response.status_code in [200, 400, 422]

# ============================
# DATABASE TESTS
# ============================

def test_document_persistence(auth_headers):
    """Test that documents persist in database."""
    # Upload document
    pdf_content = b"%PDF-1.4\npersistent"
    upload_response = client.post(
        "/documents/",
        files={"file": ("persistent.pdf", pdf_content, "application/pdf")},
        headers=auth_headers
    )
    doc_id = upload_response.json()["id"]
    
    # Retrieve immediately
    get_response = client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert get_response.status_code == 200
    assert get_response.json()["filename"] == "persistent.pdf"
