# Invoice Processor

A production-ready FastAPI service for secure document upload, OCR text extraction, and processing with PostgreSQL persistence, JWT authentication, and comprehensive error handling.

## 🎯 Project Highlights (for interview)

This project demonstrates:

- **Security**: JWT authentication, rate limiting, input validation (OWASP Top 10)
- **Architecture**: Clean 3-layer design (API → Services → Models), dependency injection
- **Database**: PostgreSQL with SQLAlchemy ORM, proper connection pooling, migrations ready
- **Error Handling**: Structured logging, audit trails, graceful error recovery
- **Testing**: Integration tests with fixtures, database mocking, auth testing
- **DevOps**: Docker Compose with health checks, environment config, scalable design
- **Code Quality**: Type hints, docstrings, proper validation, separation of concerns

## 🏗️ Architecture

```
Client Requests
     ↓
FastAPI API Layer (main.py)
  - Request validation
  - Authentication
  - Rate limiting
     ↓
Service Layer (services.py)
  - OCRService (text extraction)
  - DocumentService (DB operations)
  - FileStorageService (file handling)
     ↓
Data Layer
  - PostgreSQL (persistent storage)
  - File Storage (in-memory for demo, S3 in production)
```

## 📋 Stack

- **Backend**: FastAPI + Uvicorn
- **Database**: PostgreSQL 15 (SQLAlchemy ORM)
- **Authentication**: JWT with bcrypt password hashing
- **Security**: Rate limiting (slowapi), OWASP compliance
- **Logging**: Structured JSON logs with audit trails
- **Testing**: pytest + TestClient
- **Containerization**: Docker & Docker Compose
- **Optional**: Redis (caching, Celery tasks)

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (for local development)
- PostgreSQL 15+ (if running locally)

### With Docker (Recommended)

```bash
# 1. Clone and setup
git clone <repo>
cd invoiceprocessor
cp example.env .env

# 2. Start containers
docker compose up --build

# 3. Access API
open http://localhost:8000/docs  # Interactive API docs
```

### Local Development

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Setup database
export DATABASE_URL="postgresql://user:password@localhost:5432/invoiceprocessor"
python -c "from app.database import init_db; init_db()"

# 4. Run server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 5. Run tests
pytest tests/ -v
```

## 📚 API Documentation

Interactive API docs available at `http://localhost:8000/docs`

### Authentication

All endpoints (except `/health` and `/auth/token`) require JWT bearer token.

```bash
# Get access token
curl -X POST "http://localhost:8000/auth/token?username=user&password=pass"

# Response
{
  "access_token": "eyJhbGciOiJIUzI1NiI...",
  "token_type": "bearer",
  "expires_in": 1800
}

# Use token in requests
curl -H "Authorization: Bearer <token>" http://localhost:8000/documents/
```

### Endpoints

#### `POST /documents/` - Upload & Process Document
- **Authentication**: Required (Bearer token)
- **Rate Limit**: 10 uploads/minute
- **Content**: Multipart form-data
- **File Types**: PDF, PNG, JPG (max 50MB)

```bash
curl -X POST "http://localhost:8000/documents/" \
  -H "Authorization: Bearer <token>" \
  -F "file=@document.pdf"
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "status": "processed",
  "extracted_text": "...",
  "confidence_score": 1.0,
  "uploaded_at": "2025-12-08T10:30:00",
  "processed_at": "2025-12-08T10:30:02",
  "error_message": null
}
```

#### `GET /documents/{document_id}` - Retrieve Document
- **Authentication**: Required
- **Parameters**: `document_id` (UUID)

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/documents/550e8400-e29b-41d4-a716-446655440000
```

#### `GET /documents/` - List Documents
- **Authentication**: Required
- **Query Parameters**:
  - `skip`: Pagination offset (default: 0)
  - `limit`: Max results (default: 10, max: 100)
  - `status_filter`: Filter by status (pending|processing|processed|failed)

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8000/documents/?skip=0&limit=20&status_filter=processed"
```

#### `GET /health` - Health Check
- **No Authentication**: Public endpoint
- **Response**: `{"status": "healthy", "timestamp": "2025-12-08T10:30:00"}`

## 🔒 Security Features

### Authentication & Authorization
- JWT bearer tokens with configurable expiry (default: 30 min)
- Bcrypt password hashing (rounds: 12, OWASP recommended)
- Role-based access control ready (structure in place)

### Input Validation (OWASP A3)
- File type whitelist (PDF, PNG, JPG only)
- File size limits (max 50MB, configurable)
- Content type validation
- Pydantic schema validation on all requests

### Rate Limiting (OWASP A4)
- 10 uploads/minute per IP
- Configurable via `RATE_LIMIT_*` env vars
- Returns `429 Too Many Requests`

### Audit & Logging
- All security events logged to JSON structured logs
- User ID, resource ID, action tracked
- Timestamps in ISO 8601 format
- Suitable for SIEM integration

### Other Protections
- Non-root Docker user
- HTTPS ready (behind load balancer)
- SQL injection prevention (ORM parameterized queries)
- Environment variable secrets (never in code)

## 🗄️ Database Schema

### Documents Table
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(50),
  status VARCHAR(20),  -- pending, processing, processed, failed
  extracted_text TEXT,
  confidence_score DECIMAL(3,2),
  uploaded_by_user_id UUID,
  uploaded_at TIMESTAMP,
  processed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  error_message TEXT
);

-- Indexes for common queries
CREATE INDEX idx_status ON documents(status);
CREATE INDEX idx_uploaded_at ON documents(uploaded_at DESC);
CREATE INDEX idx_user_id ON documents(uploaded_by_user_id);
```

## 🧪 Testing

### Run All Tests
```bash
pytest tests/ -v
```

### Run Specific Test
```bash
pytest tests/test_main.py::test_upload_pdf -v
```

### With Coverage
```bash
pytest tests/ --cov=app --cov-report=html
```

### Test Categories
- **Authentication**: JWT token generation, protected endpoints
- **Upload**: File validation, processing, error handling
- **Retrieval**: Document lookup, listing, filtering
- **Rate Limiting**: Concurrency protection
- **Database**: Persistence, transactions
- **Error Handling**: Malformed requests, edge cases

## 📊 Monitoring & Logging

### Health Check
```bash
curl http://localhost:8000/health
```

### Structured Logs (JSON format)
```json
{
  "timestamp": "2025-12-08T10:30:00.123456",
  "level": "INFO",
  "name": "app.main",
  "message": "audit_event",
  "event": "document_processed",
  "user_id": "user123",
  "resource_id": "doc-uuid",
  "action": "process",
  "status": "success"
}
```

### Log Levels
- `DEBUG`: Development-only verbose output
- `INFO`: Important business events
- `WARNING`: Recoverable issues (rate limit, auth failure)
- `ERROR`: Failures requiring attention

## 🔧 Configuration

### Environment Variables (`.env`)

```env
# Application
ENVIRONMENT=production          # development|staging|production
SECRET_KEY=your-secure-key      # JWT signing key
ALGORITHM=HS256                 # JWT algorithm

# Database
DATABASE_URL=postgresql://...   # Connection string
DATABASE_POOL_SIZE=10           # Connection pool size

# Security
ACCESS_TOKEN_EXPIRE_MINUTES=30  # JWT token lifetime
RATE_LIMIT_REQUESTS=100         # Requests per window
RATE_LIMIT_WINDOW_SECONDS=60    # Rate limit window

# File Upload
MAX_UPLOAD_SIZE_MB=50           # Maximum file size

# Logging
LOG_LEVEL=INFO                  # DEBUG|INFO|WARNING|ERROR

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379/0

# Celery (optional, for background tasks)
CELERY_BROKER_URL=redis://localhost:6379/1
```

Copy `example.env` to `.env` and customize for your environment.

## 🎓 Interview Talking Points

### Architecture & Design
- **Why 3-layer architecture?** Separation of concerns, testability, scalability
- **Why SQLAlchemy?** Type-safe queries, migrations, relationship management
- **Error handling strategy**: Catch at each layer, log with context, return safe errors to client

### Scalability
- **Load balancing**: Stateless API design, database connection pooling
- **Background jobs**: Ready for Celery + Redis (workers scale independently)
- **Database**: Indexes on common queries, connection pooling prevents saturation
- **Caching**: Redis integration for frequently accessed documents

### Security
- **JWT vs Session**: JWT is stateless, better for distributed systems
- **Password hashing**: bcrypt prevents rainbow table attacks
- **Rate limiting**: Prevents brute force, DoS attacks
- **Audit logging**: Compliance, forensics, anomaly detection

### Production Improvements
1. **Replace file storage**: S3/Azure Blob for production persistence
2. **Add background workers**: Celery for long-running OCR jobs
3. **Implement caching**: Redis for frequently accessed documents
4. **Multi-tenancy**: Namespace databases, add org/team concepts
5. **Monitoring**: Prometheus metrics, APM integration
6. **CI/CD**: GitHub Actions for testing, Docker registry push
7. **Load testing**: Locust/k6 to validate performance

### Trade-offs Explained
- **In-memory storage**: Demo simplicity vs. production persistence
- **Synchronous OCR**: Blocking calls vs. async background jobs
- **Single database**: Simplicity vs. eventual sharding for scale

## 📖 Code Examples for Interview

### Example 1: File Upload with Validation
See `app/main.py` → `upload_document()` for:
- Input validation (file type, size)
- Error handling with specific HTTP codes
- Audit logging for security events
- Dependency injection (auth, database)

### Example 2: Database Operations
See `app/services.py` → `DocumentService` for:
- CRUD operations with SQLAlchemy
- Transaction management
- Error propagation
- Logging at service layer

### Example 3: Security
See `app/security.py` for:
- JWT token creation/validation
- Password hashing with bcrypt
- Protected route dependencies

## 🛠️ Development Workflow

### Adding a Feature
1. **Define schema** → `app/schemas.py`
2. **Write tests** → `tests/test_*.py`
3. **Implement service** → `app/services.py`
4. **Add endpoint** → `app/main.py`
5. **Run tests** → `pytest tests/`
6. **Test in docs** → http://localhost:8000/docs

### Deploying to Production
```bash
# 1. Build image
docker build -t invoiceprocessor:1.0.0 .

# 2. Push to registry
docker tag invoiceprocessor:1.0.0 myregistry/invoiceprocessor:1.0.0
docker push myregistry/invoiceprocessor:1.0.0

# 3. Deploy via Docker Compose or Kubernetes
docker compose -f docker-compose.prod.yml up

# 4. Run migrations
docker exec invoiceprocessor-api python -m app.database init_db
```

## 📝 License

Confidential - Docpier Interview Demo

## 🤝 Contact

For questions: [your email]

---

**Built with ❤️ for the Docpier Senior Backend Engineer role**


