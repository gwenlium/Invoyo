import asyncio
import random

class OCRService:
    """
    Simulates a heavy AI processing task for OCR!

    """
    async def extract_text(self, file_bystes: bytes) -> dict:
        # Simulate processing delax (non-bloclking)
        await asyncio.sleep(random.uniform(1, 3))  # Simulate variable processing time

        # Mock logic: reurn random "extracted" data
        return {
            "extracted_text": "This is a simulated extracted text from the document.",
            "confidence_score": round(random.uniform(0.7, 0.99), 2)
        }
    
# Singleton instance
ocr_service = OCRService()