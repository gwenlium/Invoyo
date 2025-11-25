# Invoice Processor

A minimal FastAPI service to upload invoices and extract text from PDFs (PyMuPDF).

## Stack

- FastAPI + Uvicorn
- PyMuPDF (PDF text extraction)
- Docker / Docker Compose
- pytest

## Requirements

- Docker Desktop (Windows)
- Optional: Python 3.11 for local testing

## Quick start (Docker)

```bash
# From project root
docker compose up --build
# API runs on http://localhost:8000
```

Open API docs: http://localhost:8000/docs

## API

- POST /documents/
  - multipart/form-data
  - file: PDF (application/pdf), PNG, JPG (images currently not implemented)
- GET /documents/{document_id}
  - Returns metadata and extracted text (if processed)

Example (Windows PowerShell):

```bash
curl -X POST "http://localhost:8000/documents/" -F "file=@C:\path\to\invoice.pdf"
```

## Demo script

```bash
# Run from project root
python app\demo_request.py
```

- Uploads app\data\test.pdf to the API.

## Testing

```bash
pytest tests/
```

## Notes

- Storage is in-memory; data resets on server/container restart.
- Only PDFs are processed; images return NotImplemented for now.
- Response includes: id, filename, uploaded_at, status ("processed"|"failed"), extracted_text, confidence_score.

## Troubleshooting

- Method Not Allowed when posting to /docs:
  - Use /documents/ instead of /docs.
- pip not found in MINGW64:
  - Use `python -m pip install <pkg>`.
- ModuleNotFoundError for schemas/services:
  - Use relative imports (`from .schemas import ...`, `from .services import ...`).
- ResponseValidationError (missing status):
  - Ensure `status` is set in the response dict.
- Rebuild after dependency/code changes:
  - `docker compose up --build`.

