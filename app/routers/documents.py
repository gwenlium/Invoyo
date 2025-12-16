"""Document management endpoints."""
import uuid
import logging
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import Document, DocumentStatus
from ..schemas import DocumentResponse, DocumentListResponse, DocumentUpdate
from ..legacy_services import (
    file_storage_service,
    document_service,
    process_document_logic
)
from ..security import get_current_user
from ..logging_config import log_audit_event

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)
settings = get_settings()

# Placeholder for limiter - will be injected by main.py
_limiter = None

def set_limiter(limiter):
    """Set the limiter instance for this router."""
    global _limiter
    _limiter = limiter

@router.post(
    "/",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and process a document"
)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a document for OCR processing."""
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
        
        # Process document asynchronously
        async def process_in_background():
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
                    DocumentStatus.SAVED,
                    error_message=str(e)
                )
        
        asyncio.create_task(process_in_background())
        
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

@router.get(
    "/",
    response_model=DocumentListResponse,
    summary="List user's documents"
)
async def list_documents(
    request: Request,
    skip: int = 0,
    limit: int = 10,
    status_filter: str = None,
    search_query: str = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List documents with pagination and filtering."""
    limit = min(limit, 100)
    user_id = current_user.get("user_id")
    
    query = db.query(Document).filter(Document.uploaded_by_user_id == user_id)
    
    if status_filter:
        try:
            status_enum = DocumentStatus[status_filter.upper()]
            query = query.filter(Document.status == status_enum)
        except KeyError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
            
    if search_query:
        search = f"%{search_query}%"
        query = query.filter(
            (Document.filename.ilike(search)) | 
            (Document.extracted_text.ilike(search))
        )
    
    total = query.count()
    documents = query.offset(skip).limit(limit).all()
    
    return {
        "items": [doc.to_dict() for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit
    }

@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Retrieve document details"
)
async def get_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve document metadata and extraction results."""
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

@router.get(
    "/{document_id}/download",
    summary="Download document file"
)
async def download_document_file(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Download the raw file content."""
    user_id = current_user.get("user_id")
    
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    file_content = file_storage_service.get(document_id)
    if not file_content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File content not found"
        )

    return Response(
        content=file_content,
        media_type=document.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{document.filename}"'
        }
    )

@router.patch(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Update document details"
)
async def update_document(
    document_id: str,
    updates: DocumentUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update document details (manual overrides)."""
    user_id = current_user.get("user_id")
    
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if document.uploaded_by_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update your own documents"
        )

    update_data = updates.dict(exclude_unset=True)
    update_data["processed_at"] = datetime.utcnow()

    updated_doc = document_service.update_document_metadata(
        db,
        document_id,
        update_data
    )
    
    return updated_doc.to_dict()

@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document"
)
async def delete_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a document and its stored file."""
    user_id = current_user.get("user_id")

    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    # Check authorization: user must own the document or be admin
    is_admin = current_user.get("role") == "admin"
    is_owner = document.uploaded_by_user_id == user_id
    
    if not (is_owner or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to delete this document"
        )

    document_service.delete_document(db, document_id)
    file_storage_service.delete(document_id)

    log_audit_event(
        "document_deleted",
        user_id=user_id,
        resource_id=document_id,
        action="delete",
        details={"admin_action": is_admin},
        status="success"
    )
    
    logger.info(f"User {user_id} deleted document {document_id}")
