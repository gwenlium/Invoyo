from pydantic import BaseModel  # type: ignore
from datetime import datetime
from enum import Enum

class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSED = "processed"
    FAILED = "failed"

# What we return to the client
class DocumentResponse(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    status: DocumentStatus
    extracted_text: str | None = None  # Optional field
    confidence_score: float | None = None