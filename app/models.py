"""
Database models using SQLAlchemy ORM.
Demonstrates proper database design for document processing.
"""
from sqlalchemy import Column, String, DateTime, Float, Text, Enum as SQLEnum, Index, func
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from enum import Enum

Base = declarative_base()

class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"

class Document(Base):
    """Stores document metadata."""
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True)  # UUID
    filename = Column(String(255), nullable=False)
    content_type = Column(String(50), nullable=False)
    file_size_bytes = Column(String, nullable=True)  # Will store in S3, not DB
    storage_path = Column(String(500), nullable=True)  # S3 key or file path
    status = Column(SQLEnum(DocumentStatus), default=DocumentStatus.PENDING, nullable=False)
    
    # Extracted data
    extracted_text = Column(Text, nullable=True)
    confidence_score = Column(Float, nullable=True)
    
    # Metadata
    uploaded_at = Column(DateTime, default=func.now(), nullable=False)
    processed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Audit trail
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    uploaded_by_user_id = Column(String(36), nullable=True)  # For multi-tenant future
    
    # Create indexes for common queries
    __table_args__ = (
        Index('idx_status', 'status'),
        Index('idx_uploaded_at', 'uploaded_at'),
        Index('idx_user_id', 'uploaded_by_user_id'),
        Index('idx_created_at', 'created_at'),
    )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "filename": self.filename,
            "status": self.status.value,
            "extracted_text": self.extracted_text,
            "confidence_score": self.confidence_score,
            "uploaded_at": self.uploaded_at,
            "processed_at": self.processed_at,
            "error_message": self.error_message,
        }
