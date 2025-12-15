"""Business logic layer: OCR, storage, document processing."""
import asyncio
import logging
import fitz  # PyMuPDF
import os
import cv2
import numpy as np
import base64
from pathlib import Path
from typing import Dict, Optional
from sqlalchemy.orm import Session
from .models import Document, DocumentStatus
from datetime import datetime

logger = logging.getLogger(__name__)

class OCRService:
    """Extracts text and QR codes from documents."""
    
    async def extract_text(self, file_content: bytes, content_type: str) -> Dict:
        """
        Extracts text and QR codes from PDF or image files.
        """
        if content_type not in ["application/pdf", "image/png", "image/jpeg"]:
            raise ValueError(f"Unsupported content type: {content_type}")
        
        # Run blocking I/O in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._extract_sync, file_content, content_type)

    def _extract_sync(self, file_content: bytes, content_type: str) -> Dict:
        """Synchronous text and QR extraction."""
        try:
            # Map mime type to fitz filetype
            filetype = "pdf"
            if content_type == "image/png":
                filetype = "png"
            elif content_type == "image/jpeg":
                filetype = "jpeg"

            text = ""
            qr_codes = []
            qr_code_base64 = None
            
            # Open document from in-memory byte stream
            with fitz.open(stream=file_content, filetype=filetype) as doc:
                for page in doc:
                    # Extract text
                    text += page.get_text()
                    
                    # Extract QR codes
                    # Render page to image (pixmap)
                    pix = page.get_pixmap(dpi=150) # 150 DPI is usually enough for QR
                    
                    # Convert to numpy array for OpenCV
                    # pix.samples is a bytes object
                    img_data = np.frombuffer(pix.samples, dtype=np.uint8)
                    
                    # Reshape based on channels
                    if pix.n == 4: # RGBA
                        img_data = img_data.reshape(pix.h, pix.w, 4)
                        img_data = cv2.cvtColor(img_data, cv2.COLOR_RGBA2BGR)
                    elif pix.n == 3: # RGB
                        img_data = img_data.reshape(pix.h, pix.w, 3)
                        img_data = cv2.cvtColor(img_data, cv2.COLOR_RGB2BGR)
                    elif pix.n == 1: # Gray
                        img_data = img_data.reshape(pix.h, pix.w)
                        img_data = cv2.cvtColor(img_data, cv2.COLOR_GRAY2BGR)
                    
                    # Detect QR code
                    detector = cv2.QRCodeDetector()
                    data, bbox, rectified_image = detector.detectAndDecode(img_data)
                    if data:
                        qr_codes.append(data)
                        # If we haven't captured a QR image yet, capture this one
                        if qr_code_base64 is None and rectified_image is not None and rectified_image.size > 0:
                            try:
                                # Encode to PNG
                                _, buffer = cv2.imencode('.png', rectified_image)
                                qr_code_base64 = base64.b64encode(buffer).decode('utf-8')
                            except Exception as e:
                                logger.warning(f"Failed to encode QR image: {e}")

            logger.info(f"Successfully extracted text ({len(text)} chars) and {len(qr_codes)} QR codes")
            
            return {
                "extracted_text": text,
                "qr_code_data": "\n".join(qr_codes) if qr_codes else None,
                "qr_code_base64": qr_code_base64,
                "confidence_score": 1.0
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
            status=DocumentStatus.SAVED,
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
        qr_code_data: Optional[str] = None,
        qr_code_base64: Optional[str] = None,
        confidence_score: Optional[float] = None,
        error_message: Optional[str] = None
    ) -> Document:
        """Update document after processing."""
        document = db.query(Document).filter(Document.id == doc_id).first()
        if not document:
            raise ValueError(f"Document {doc_id} not found")
        
        document.status = status
        document.extracted_text = extracted_text
        document.qr_code_data = qr_code_data
        document.qr_code_base64 = qr_code_base64
        document.confidence_score = confidence_score
        document.error_message = error_message
        
        if status == DocumentStatus.PROCESSED:
            from datetime import datetime
            document.processed_at = datetime.utcnow()
        
        db.commit()
        db.refresh(document)
        logger.info(f"Updated document {doc_id} to status: {status}")
        return document

    @staticmethod
    def update_document_metadata(
        db: Session,
        doc_id: str,
        updates: Dict
    ) -> Document:
        """Update document metadata (manual overrides)."""
        document = db.query(Document).filter(Document.id == doc_id).first()
        if not document:
            raise ValueError(f"Document {doc_id} not found")
        
        for key, value in updates.items():
            if hasattr(document, key):
                setattr(document, key, value)
        # Always track user modifications with a fresh timestamp
        document.processed_at = datetime.utcnow()
        
        db.commit()
        db.refresh(document)
        logger.info(f"Updated document metadata for {doc_id}")
        return document

    @staticmethod
    def delete_document(db: Session, doc_id: str) -> bool:
        """Delete document record from database."""
        document = db.query(Document).filter(Document.id == doc_id).first()
        if not document:
            return False
        db.delete(document)
        db.commit()
        logger.info(f"Deleted document record {doc_id}")
        return True

class FileStorageService:
    """Handle file storage operations using local filesystem."""
    
    def __init__(self):
        # Store files in app/data/storage
        self.storage_dir = Path(__file__).parent / "data" / "storage"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"FileStorageService initialized at {self.storage_dir}")

    def save(self, file_id: str, content: bytes) -> str:
        """Save file and return storage path."""
        file_path = self.storage_dir / file_id
        with open(file_path, "wb") as f:
            f.write(content)
        logger.info(f"Stored file: {file_id} ({len(content)} bytes)")
        return str(file_path)

    def get(self, file_id: str) -> Optional[bytes]:
        """Retrieve file from storage."""
        file_path = self.storage_dir / file_id
        if file_path.exists():
            with open(file_path, "rb") as f:
                return f.read()
        return None

    def delete(self, file_id: str) -> bool:
        """Remove stored file if it exists."""
        file_path = self.storage_dir / file_id
        if file_path.exists():
            try:
                file_path.unlink()
                logger.info(f"Deleted stored file: {file_id}")
                return True
            except Exception as exc:
                logger.warning(f"Failed to delete file {file_id}: {exc}")
        return False
    
    def delete(self, file_id: str) -> bool:
        """Delete file from storage."""
        file_path = self.storage_dir / file_id
        if file_path.exists():
            os.remove(file_path)
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
    3. For 'saved' status documents, keep them in 'saved' state (user decides when to mark as paid/unpaid)
    4. Handle errors gracefully
    """
    try:
        # Get current document to check its status
        current_doc = db.query(Document).filter(Document.id == file_id).first()
        if not current_doc:
            raise ValueError(f"Document {file_id} not found")
        
        # Extract text
        extraction_result = await ocr_service.extract_text(file_content, content_type)
        
        # If document is in 'saved' status, keep it there and just update the extracted data
        # Otherwise update to PROCESSED as normal
        new_status = current_doc.status if current_doc.status == DocumentStatus.SAVED else DocumentStatus.PROCESSED
        
        # Update database
        document_service.update_document_processing(
            db,
            file_id,
            new_status,
            extracted_text=extraction_result["extracted_text"],
            qr_code_data=extraction_result["qr_code_data"],
            qr_code_base64=extraction_result.get("qr_code_base64"),
            confidence_score=extraction_result["confidence_score"]
        )
        
        logger.info(f"Successfully processed document: {file_id} (status: {new_status})")
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