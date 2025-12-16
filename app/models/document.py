"""
Document model for invoice storage and processing.
"""
from sqlalchemy import Column, String, DateTime, Float, Text, Enum as SQLEnum, Index, func
from datetime import datetime, timezone
from enum import Enum
import re
from .base import Base


class DocumentStatus(str, Enum):
    """Document status."""
    PAID = "paid"
    UNPAID = "unpaid"
    ARCHIVED = "archived"
    UNARCHIVED = "unarchived"
    SAVED = "saved"


class Document(Base):
    """Stores document metadata."""
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(50), nullable=False)
    file_size_bytes = Column(String, nullable=True)
    storage_path = Column(String(500), nullable=True)
    status = Column(
        SQLEnum(
            DocumentStatus,
            name="documentstatus",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=DocumentStatus.SAVED,
        nullable=False,
    )
    
    # Extracted data
    extracted_text = Column(Text, nullable=True)
    qr_code_data = Column(Text, nullable=True)
    qr_code_base64 = Column(Text, nullable=True)
    confidence_score = Column(Float, nullable=True)
    
    # Manual Overrides
    confirmed_due_date = Column(String(50), nullable=True)
    confirmed_amount = Column(String(50), nullable=True)
    
    # Metadata
    uploaded_at = Column(DateTime, default=func.now(), nullable=False)
    processed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Audit trail
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    uploaded_by_user_id = Column(String(36), nullable=True)
    
    # Create indexes for common queries
    __table_args__ = (
        Index('idx_status', 'status'),
        Index('idx_uploaded_at', 'uploaded_at'),
        Index('idx_user_id', 'uploaded_by_user_id'),
        Index('idx_created_at', 'created_at'),
    )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        from ..services.document_parser import extract_due_date, extract_amount, derive_paid_status
        
        derived_due = self.confirmed_due_date if self.confirmed_due_date else extract_due_date(self.extracted_text)
        derived_amount = self.confirmed_amount if self.confirmed_amount else extract_amount(self.extracted_text)
        derived_paid = derive_paid_status(self.extracted_text, self.status.value)
        
        # Ensure timestamps are in UTC and ISO format
        uploaded_at_utc = self.uploaded_at.replace(tzinfo=timezone.utc) if self.uploaded_at and not self.uploaded_at.tzinfo else self.uploaded_at
        processed_at_utc = self.processed_at.replace(tzinfo=timezone.utc) if self.processed_at and not self.processed_at.tzinfo else self.processed_at
        
        return {
            "id": self.id,
            "filename": self.filename,
            "status": self.status.value,
            "extracted_text": self.extracted_text,
            "qr_code_data": self.qr_code_data,
            "confidence_score": self.confidence_score,
            "uploaded_at": uploaded_at_utc.isoformat() if uploaded_at_utc else None,
            "processed_at": processed_at_utc.isoformat() if processed_at_utc else None,
            "error_message": self.error_message,
            "derived_due": derived_due,
            "derived_amount": derived_amount,
            "derived_paid": derived_paid,
            "confirmed_due_date": self.confirmed_due_date,
            "confirmed_amount": self.confirmed_amount,
        }
