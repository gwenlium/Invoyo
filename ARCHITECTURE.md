# Backend Architecture

## File Structure

```
app/
├── models/                  # Database schema
│   ├── base.py             # SQLAlchemy Base
│   ├── user.py             # User, UserRole
│   └── document.py         # Document, DocumentStatus
├── services/                # Business logic
│   ├── user_service.py     # User CRUD
│   └── document_parser.py  # Text extraction
├── legacy_services.py       # OCR, storage, document processing
├── auth.py                  # Authentication endpoints
├── main.py                  # Document routes
├── security.py              # JWT, passwords, RBAC
├── schemas.py               # Request/response validation
├── database.py              # DB connection
├── config.py                # Environment config
└── logging_config.py        # Audit logging
```

## Design Principles

**Separation of Concerns**
- Models: Database schema only
- Services: Reusable business logic
- Routes: HTTP handling, orchestration
- Security: Authentication and authorization

**Single Responsibility**
- Each module has one clear purpose
- Easy to test in isolation
- Changes don't cascade

**Data Flow**
```
HTTP Request → Route → Schema Validation → Service → Model → Database
```

## Security

**Authentication Flow**
1. Register: First user becomes admin
2. Login: Returns JWT access (15min) + refresh (7day) tokens
3. Protected routes: Validate JWT via `Depends(get_current_user)`
4. Admin routes: Require `Depends(get_current_admin_user)`

**Features**
- JWT with token type validation
- Bcrypt password hashing
- Rate limiting on auth endpoints
- Role-based access control
- Audit logging for security events

## Testing

Services are testable without database:
```python
def test_extract_due_date():
    result = extract_due_date("Due date: 12.05.2025")
    assert result == "12.05.2025"
```

Routes tested with test database:
```python
def test_register_user(test_db):
    response = client.post("/auth/register", json={...})
    assert response.status_code == 201
```

## Benefits

- Small, focused files
- Clear module boundaries
- Easy to mock and test
- Centralized security logic
- Scalable to microservices
