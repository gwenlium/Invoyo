import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException
from datetime import datetime
from schemas import DocumentResponse, DocumentStatus
from services import ocr_service, storage_service

app = FastAPI(title = "Invoice Processor API")

# In-memory "database" to store document metadata
db = {}

@app.post("/documents/", response_model=DocumentResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Uploads a file and triggers a mock extraction process.
    """
    # 1. Validation (Security)
    if file.content_type not in ["application/pdf", "image/png", "image/jpeg"]:
        raise HTTPException(status_code=400, detail="Invalid file type. Only PDF/PNG/JPG allowed.")
    
    # 2. Simulate saving the file to storage
    file_id = str(uuid.uuid4())
    # In a real app, we would stream this to disk/cloud. not read into RAM!
    content = await file.read()
    storage_service.save(file_id, content)

    # 3. Process the document
    try:
        extraction_result = await ocr_service.extract_text(content)
        staus = DocumentStatus.PROCESSED
    except Exception as e:
        extraction_result = {"extracted_text": None, "confidence_score": None}
        status = DocumentStatus.FAILED

    # 4. Create record
    doc_record = {
        "id": file_id,
        "filename": file.filename,
        "uploaded_at": datetime.utcnow(),
        "status": status,
        "extracted_text": extraction_result["extracted_text"],
        "confidence_score": extraction_result["confidence_score"]
    }

    # Save to mock DB
    db[file_id] = doc_record
    return doc_record

@app.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str):
    if document_id not in db:
        raise HTTPException(status_code=404, detail="Document not found.")
    return db[document_id]