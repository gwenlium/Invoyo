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

class DocumentResponse(BaseModel):
    """API response for document metadata and extraction."""
    id: str = Field(..., description="Unique document ID (UUID)")
    filename: str = Field(..., description="Original filename")
    status: DocumentStatus = Field(..., description="Processing status")
    extracted_text: Optional[str] = Field(None, description="Extracted text from OCR")
    confidence_score: Optional[float] = Field(None, description="OCR confidence (0-1)")
    uploaded_at: datetime = Field(..., description="Upload timestamp")
    processed_at: Optional[datetime] = Field(None, description="Processing completion time")
    error_message: Optional[str] = Field(None, description="Error details if processing failed")
    
    class Config:
        from_attributes = True  # Support SQLAlchemy models

class DocumentListResponse(BaseModel):
    """Paginated list of documents."""
    items: List[DocumentResponse] = Field(..., description="List of documents")
    total: int = Field(..., description="Total documents matching filter")
    skip: int = Field(..., description="Number of documents skipped (pagination)")
    limit: int = Field(..., description="Maximum documents returned")
