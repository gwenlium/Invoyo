"""FastAPI application with security, database, and error handling."""
import uuid
import logging
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db, init_db
from .models import Document, DocumentStatus as DBDocumentStatus
from .schemas import DocumentResponse, DocumentStatus, DocumentListResponse
from .services import (
    ocr_service,
    file_storage_service,
    document_service,
    process_document_logic
)
from .security import get_current_user, create_access_token
from .logging_config import configure_logging, log_audit_event
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging
settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

# Initialize app
app = FastAPI(
    title="Invoice Processor API",
    version="1.0.0",
    description="Secure document processing with OCR text extraction"
)

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    """Handle rate limit exceeded."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "Rate limit exceeded. Please try again later."}
    )

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}", exc_info=True)
        raise

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for load balancers."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# =====================
# DOCUMENT ENDPOINTS
# =====================

@app.post(
    "/documents/",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and process a document"
)
@limiter.limit("10/minute")  # 10 uploads per minute
async def upload_document(
    request: Request,  # ← required for SlowAPI
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload a document for OCR processing.
    
    - **file**: PDF, PNG, or JPG file (max 50MB)
    - Requires: Bearer token authentication
    
    Returns: Document metadata with extraction status
    """
    user_id = current_user.get("user_id")
    
    # Validation: file type
    if file.content_type not in ["application/pdf", "image/png", "image/jpeg"]:
        log_audit_event(
            "invalid_file_upload",
            user_id=user_id,
            action="upload",
            details={"content_type": file.content_type},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Invalid file type. Only PDF/PNG/JPG allowed."
        )
    
    # Validation: file size
    content = await file.read()
    max_size = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum {settings.max_upload_size_mb}MB allowed."
        )
    
    try:
        # Create document record
        file_id = str(uuid.uuid4())
        document = document_service.create_document(
            db,
            file_id,
            file.filename,
            file.content_type,
            user_id=user_id
        )
        
        # Store file
        file_storage_service.save(file_id, content)
        
        # Process document
        try:
            extraction_result = await process_document_logic(
                db,
                file_id,
                content,
                file.content_type
            )
            log_audit_event(
                "document_processed",
                user_id=user_id,
                resource_id=file_id,
                action="process",
                status="success"
            )
        except Exception as e:
            logger.error(f"OCR processing failed: {e}")
            document_service.update_document_processing(
                db,
                file_id,
                DocumentStatus.FAILED,
                error_message=str(e)
            )
            # Don't raise - return error in response
        
        # Fetch updated document
        document = document_service.get_document(db, file_id)
        return document.to_dict()
        
    except Exception as e:
        logger.error(f"Upload failed: {e}", exc_info=True)
        log_audit_event(
            "upload_error",
            user_id=user_id,
            action="upload",
            details={"error": str(e)},
            status="failed"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during upload"
        )

@app.get(
    "/documents/{document_id}",
    response_model=DocumentResponse,
    summary="Retrieve document details"
)
async def get_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retrieve document metadata and extraction results.
    
    - **document_id**: UUID of the document
    """
    user_id = current_user.get("user_id")
    
    document = document_service.get_document(db, document_id)
    if not document:
        log_audit_event(
            "document_not_found",
            user_id=user_id,
            resource_id=document_id,
            action="retrieve",
            status="failed"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    log_audit_event(
        "document_retrieved",
        user_id=user_id,
        resource_id=document_id,
        action="retrieve",
        status="success"
    )
    return document.to_dict()

@app.get(
    "/documents/",
    response_model=DocumentListResponse,
    summary="List user's documents"
)
@limiter.limit("30/minute")
async def list_documents(
    request: Request,              # ← add this
    skip: int = 0,
    limit: int = 10,
    status_filter: str = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List documents with pagination and filtering.
    
    - **skip**: Number of documents to skip (pagination)
    - **limit**: Maximum documents to return (max 100)
    - **status_filter**: Filter by status (pending, processing, processed, failed)
    """
    limit = min(limit, 100)  # Prevent abuse
    user_id = current_user.get("user_id")
    
    query = db.query(Document).filter(Document.uploaded_by_user_id == user_id)
    
    if status_filter:
        try:
            status_enum = DBDocumentStatus[status_filter.upper()]
            query = query.filter(Document.status == status_enum)
        except KeyError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
    
    total = query.count()
    documents = query.offset(skip).limit(limit).all()
    
    return {
        "items": [doc.to_dict() for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit
    }

# =====================
# AUTHENTICATION
# =====================

@app.post("/auth/token", summary="Get access token")
async def login(username: str, password: str):
    """
    Get JWT access token for API authentication.
    
    In production, validate credentials against user database.
    """
    # TODO: Validate username/password against database
    # For demo, accept any credentials
    
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": username},
        expires_delta=access_token_expires
    )
    
    log_audit_event(
        "user_login",
        user_id=username,
        action="authenticate",
        status="success"
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60
    }
