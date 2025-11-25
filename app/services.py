import asyncio
import time
import random
import fitz  # PyMuPDF

class OCRService:
    async def extract_text(self, file_content: bytes, content_type: str):
        """Extracts text from a given file's content."""
        print(f"OCR service processing file of type {content_type}...")
        
        # This solution focuses on PDF. For images, you'd need an OCR engine
        # like Tesseract and a library like Pytesseract.
        if content_type != "application/pdf":
            # For now, we'll raise an exception for non-PDFs.
            # In a real app, you might route to a different service.
            raise NotImplementedError(f"Processing for {content_type} is not implemented.")

        try:
            # Open the PDF from the in-memory byte stream
            pdf_document = fitz.open(stream=file_content, filetype="pdf")
            
            text = ""
            for page_num in range(len(pdf_document)):
                page = pdf_document.load_page(page_num)
                text += page.get_text()
            
            pdf_document.close()

            # PyMuPDF doesn't provide a single confidence score for the whole text.
            # We'll return 1.0 as a placeholder.
            return {
                "extracted_text": text,
                "confidence_score": 1.0 
            }
        except Exception as e:
            print(f"Error processing PDF with PyMuPDF: {e}")
            raise Exception("Failed to extract text from PDF.") from e


class MockStorageService:
    """A mock storage service that saves files in-memory."""
    def __init__(self):
        self._storage = {}
        print("MockStorageService initialized.")

    def save(self, file_id: str, content: bytes):
        print(f"Saving file {file_id} to mock in-memory storage.")
        self._storage[file_id] = content

    def get(self, file_id: str) -> bytes | None:
        return self._storage.get(file_id)

# Instantiate services
ocr_service = OCRService()
storage_service = MockStorageService()

async def process_document_logic(file_id: str):
    # Retrieve file from storage
    file_content = storage_service.get(file_id)
    if file_content is None:
        print(f"File {file_id} not found in storage.")
        return {"success": False, "error": "File not found."}

    try:
        # Extract text using OCR service
        result = await ocr_service.extract_text(file_content, "application/pdf")
        print(f"Extracted data: {result}")

        # Here you can add additional logic, like saving the result to a database

        return {"success": True, "data": result}

    except Exception as e:
        print(f"Error processing document: {e}")
        return {"success": False, "error": str(e)}