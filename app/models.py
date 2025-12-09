"""
Database models using SQLAlchemy ORM.
"""
from sqlalchemy import Column, String, DateTime, Float, Text, Enum as SQLEnum, Index, func
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timezone
from enum import Enum
import re

Base = declarative_base()

class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"
    PAID = "paid"
    ARCHIVED = "archived"
    SAVED = "saved"

class Document(Base):
    """Stores document metadata."""
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(50), nullable=False)
    file_size_bytes = Column(String, nullable=True)
    storage_path = Column(String(500), nullable=True)
    status = Column(SQLEnum(DocumentStatus), default=DocumentStatus.SAVED, nullable=False)
    
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


def extract_due_date(text: str | None) -> str | None:
    """Best-effort parse of due date."""
    if not text:
        return None
    
    # Common date formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
    # We look for them following keywords
    date_regex = r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})"
    
    # Keywords in English, German, French
    keywords = [
        r"Due\s*date", r"Due\s*by", r"Payable\s*by", r"Payment\s*due",  # English
        r"Fällig\s*am", r"Bezahlbar\s*bis", r"Zahlbar\s*bis", r"Fälligkeitsdatum",  # German
        r"Echéance", r"Payable\s*le"  # French
    ]
    
    # Construct a pattern like: (?:Due date|Payable by)[:\s]*(date_regex)
    pattern = f"(?:{'|'.join(keywords)})[:\s]*{date_regex}"
    
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1)
        
    return None


def extract_amount(text: str | None) -> str | None:
    """Grab the total amount."""
    if not text:
        return None
        
    # Look for currency symbols or keywords
    # 123.45 or 123,45 or 1,234.56 or 1.234,56
    amount_regex = r"(\d{1,3}(?:[.,']\d{3})*[.,]\d{2})"
    
    keywords = [
        r"Total", r"Amount\s*Due", r"Grand\s*Total", r"Balance\s*Due", r"Invoice\s*Total",  # English
        r"Gesamtbetrag", r"Endbetrag", r"Betrag", r"Summe", r"Rechnungsbetrag",  # German
        r"Total\s*TTC", r"Montant"  # French
    ]
    
    pattern = f"(?:{'|'.join(keywords)})[^0-9\n]*{amount_regex}"
    
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1)
        
    # Fallback: Find the largest number that looks like a currency at the end of the document?
    # Or just return the last match found (often the total is at the bottom)
    matches = re.findall(amount_regex, text)
    if matches:
        return matches[-1]
        
    return None


def derive_paid_status(text: str | None, status: str) -> str:
    if text:
        lower = text.lower()
        if "bezahlt" in lower or "paid" in lower:
            return "Paid"
    if status == "processed":
        return "Unpaid"
    return "Pending"
