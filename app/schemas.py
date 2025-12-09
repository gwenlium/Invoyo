"""Request and response schemas using Pydantic for validation."""
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
from typing import Optional, List

class DocumentStatus(str, Enum):
    """Document processing status."""
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"
    PAID = "paid"
    ARCHIVED = "archived"
    SAVED = "saved"

class DocumentResponse(BaseModel):
    """API response for document metadata and extraction."""
    id: str = Field(..., description="Unique document ID (UUID)")
    filename: str = Field(..., description="Original filename")
    status: DocumentStatus = Field(..., description="Processing status")
    extracted_text: Optional[str] = Field(None, description="Extracted text from OCR")
    qr_code_data: Optional[str] = Field(None, description="Extracted QR code data")
    qr_code_base64: Optional[str] = Field(None, description="Base64 encoded QR code image")
    confidence_score: Optional[float] = Field(None, description="OCR confidence (0-1)")
    uploaded_at: datetime = Field(..., description="Upload timestamp")
    processed_at: Optional[datetime] = Field(None, description="Processing completion time")
    error_message: Optional[str] = Field(None, description="Error details if processing failed")
    derived_due: Optional[str] = Field(None, description="Parsed due date if found in text")
    derived_amount: Optional[str] = Field(None, description="Parsed total amount if found in text")
    derived_paid: Optional[str] = Field(None, description="Heuristic paid status (Paid/Unpaid/Pending)")
    confirmed_due_date: Optional[str] = Field(None, description="Manually confirmed due date")
    confirmed_amount: Optional[str] = Field(None, description="Manually confirmed amount")
    
    class Config:
        from_attributes = True  # Support SQLAlchemy models

class DocumentUpdate(BaseModel):
    """Schema for updating document details."""
    confirmed_due_date: Optional[str] = None
    confirmed_amount: Optional[str] = None
    status: Optional[DocumentStatus] = None

class DocumentListResponse(BaseModel):
    """Paginated list of documents."""
    items: List[DocumentResponse] = Field(..., description="List of documents")
    total: int = Field(..., description="Total documents matching filter")
    skip: int = Field(..., description="Number of documents skipped (pagination)")
    limit: int = Field(..., description="Maximum documents returned")
