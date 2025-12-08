"""Business logic layer: OCR, storage, document processing."""
import asyncio
import logging
import fitz  # PyMuPDF
from typing import Dict, Optional
from sqlalchemy.orm import Session
from .models import Document, DocumentStatus

logger = logging.getLogger(__name__)

class OCRService:
    """Extracts text from documents using PyMuPDF."""
    
    async def extract_text(self, file_content: bytes, content_type: str) -> Dict:
        """
        Extracts text from PDF or image files.
        Runs blocking I/O in thread pool to prevent event loop blocking.
        """
        if content_type not in ["application/pdf", "image/png", "image/jpeg"]:
            raise ValueError(f"Unsupported content type: {content_type}")
        
        # Run blocking I/O in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._extract_sync, file_content)

    def _extract_sync(self, file_content: bytes) -> Dict:
        """Synchronous text extraction (blocking operation)."""
        try:
            # Open PDF from in-memory byte stream
            pdf_document = fitz.open(stream=file_content, filetype="pdf")
            
            text = ""
            for page_num in range(len(pdf_document)):
                page = pdf_document.load_page(page_num)
                text += page.get_text()
            
            pdf_document.close()

            logger.info(f"Successfully extracted text from PDF ({len(text)} chars)")
            
            return {
                "extracted_text": text,
                "confidence_score": 1.0  # PyMuPDF doesn't provide confidence
            }
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}", exc_info=True)
            raise

class DocumentService:
    """Handle document database operations."""
    
    @staticmethod
    def create_document(
        db: Session,
        doc_id: str,
        filename: str,
        content_type: str,
        user_id: Optional[str] = None
    ) -> Document:
        """Create a new document record in database."""
        document = Document(
            id=doc_id,
            filename=filename,
            content_type=content_type,
            status=DocumentStatus.PENDING,
            uploaded_by_user_id=user_id,
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        logger.info(f"Created document record: {doc_id}")
        return document
    
    @staticmethod
    def get_document(db: Session, doc_id: str) -> Optional[Document]:
        """Retrieve document by ID."""
        return db.query(Document).filter(Document.id == doc_id).first()
    
    @staticmethod
    def update_document_processing(
        db: Session,
        doc_id: str,
        status: DocumentStatus,
        extracted_text: Optional[str] = None,
        confidence_score: Optional[float] = None,
        error_message: Optional[str] = None
    ) -> Document:
        """Update document after processing."""
        document = db.query(Document).filter(Document.id == doc_id).first()
        if not document:
            raise ValueError(f"Document {doc_id} not found")
        
        document.status = status
        document.extracted_text = extracted_text
        document.confidence_score = confidence_score
        document.error_message = error_message
        
        if status == DocumentStatus.PROCESSED:
            from datetime import datetime
            document.processed_at = datetime.utcnow()
        
        db.commit()
        db.refresh(document)
        logger.info(f"Updated document {doc_id} to status: {status}")
        return document

class FileStorageService:
    """Handle file storage operations (mock for demo)."""
    
    def __init__(self):
        self._storage = {}
        logger.info("FileStorageService initialized (in-memory)")

    def save(self, file_id: str, content: bytes) -> str:
        """Save file and return storage path."""
        self._storage[file_id] = content
        logger.info(f"Stored file: {file_id} ({len(content)} bytes)")
        return f"storage/{file_id}"

    def get(self, file_id: str) -> Optional[bytes]:
        """Retrieve file from storage."""
        return self._storage.get(file_id)
    
    def delete(self, file_id: str) -> bool:
        """Delete file from storage."""
        if file_id in self._storage:
            del self._storage[file_id]
            logger.info(f"Deleted file: {file_id}")
            return True
        return False

# Instantiate services
ocr_service = OCRService()
document_service = DocumentService()
file_storage_service = FileStorageService()

async def process_document_logic(
    db: Session,
    file_id: str,
    file_content: bytes,
    content_type: str
) -> Dict:
    """
    Main processing logic:
    1. Extract text using OCR
    2. Update document in database
    3. Handle errors gracefully
    """
    try:
        # Extract text
        extraction_result = await ocr_service.extract_text(file_content, content_type)
        
        # Update database
        document_service.update_document_processing(
            db,
            file_id,
            DocumentStatus.PROCESSED,
            extracted_text=extraction_result["extracted_text"],
            confidence_score=extraction_result["confidence_score"]
        )
        
        logger.info(f"Successfully processed document: {file_id}")
        return extraction_result
        
    except Exception as e:
        logger.error(f"Processing failed for {file_id}: {e}", exc_info=True)
        # Update document with error
        document_service.update_document_processing(
            db,
            file_id,
            DocumentStatus.FAILED,
            error_message=str(e)
        )
        raise
        return {"success": False, "error": str(e)}