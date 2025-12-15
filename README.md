# Invoyo

Invoice management tool with automatic OCR extraction. Upload PDFs or images, extract text and QR codes, track payment status.

## Features

- Smart text extraction (dates, amounts, QR codes)
- Multi-priority amount detection with keyword matching
- Document workflow (Saved → Unpaid → Paid → Archived)
- Real-time OCR processing
- File type filtering
- Local timezone support
- Secure JWT authentication with RBAC

## Quick Start

**Requirements**: Docker

### Development
```bash
docker compose -f docker-compose.dev.yml up --build
```
- Frontend: http://localhost:4200
- API Docs: http://localhost:8000/docs

### Production
```bash
docker compose up --build
```
- App: http://localhost
- API: http://localhost:8000

## Tech Stack

**Frontend**: Angular 19 (TypeScript, Standalone Components, Signals)  
**Backend**: FastAPI, SQLAlchemy, PyMuPDF, OpenCV, pyzbar  
**Database**: PostgreSQL 15  
**Cache**: Redis  
**Auth**: JWT with role-based access control

## Configuration

Copy `example.env` to `.env` and update:
- Database credentials
- JWT secret keys
- Redis connection
- API URLs

See [SECURITY.md](SECURITY.md) for production deployment guidelines.

## Architecture

Clean architecture with separation of concerns:
- Models: Database schema
- Services: Business logic
- Routes: HTTP handling
- Security: JWT, RBAC, rate limiting

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Workflow

1. **Upload**: Drop files (status: Saved)
2. **Process**: Background OCR extraction
3. **Review**: Documents marked Unpaid after processing
4. **Manage**: Mark as Paid or edit manually
5. **Archive**: Move to historical records

## Status System

- **Saved** - Newly uploaded, awaiting OCR
- **Unpaid** - Processed, awaiting payment
- **Paid** - Payment confirmed
- **Archived** - Historical records

## License

Open source, available for personal and commercial use.


