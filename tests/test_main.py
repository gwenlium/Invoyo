import pytest
from fastapi.testclient import TestClient
from app.main import app

# Create a test client linked to your app
client = TestClient(app)

def test_upload_invoice_success():
    """
    Test that uploading a PDF returns 200 and the correct JSON structure.
    """
    # 1. Simulate a PDF file
    file_content = b"%PDF-1.4 ... dummy content ..."
    files = {
        "file": ("test.pdf", file_content, "application/pdf")
    }

    # 2. Make the request (note the trailing slash)
    response = client.post("/documents/", files=files)

    # 3. Assertions (The "Test")
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test.pdf"
    assert data["status"] in ["processed", "failed"]  # Can be either based on OCR result
    assert "id" in data  # Ensure an ID was generated
    assert "extracted_text" in data
    assert "confidence_score" in data

def test_upload_invalid_file_type():
    """
    Test that uploading a text file is rejected.
    """
    files = {
        "file": ("notes.txt", b"just text", "text/plain")
    }
    
    # Add trailing slash to match your endpoint
    response = client.post("/documents/", files=files)
    
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid file type. Only PDF/PNG/JPG allowed."