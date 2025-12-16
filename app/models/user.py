"""
User model for authentication and authorization.
"""
from sqlalchemy import Column, String, DateTime, Boolean, Enum as SQLEnum, Index, func
from enum import Enum
from .base import Base


class UserRole(str, Enum):
    """User roles for authorization."""
    ADMIN = "admin"
    USER = "user"


class User(Base):
    """User model for authentication and authorization."""
    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.USER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    
    # Audit
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    last_login = Column(DateTime, nullable=True)
    
    __table_args__ = (
        Index('idx_email', 'email'),
        Index('idx_username', 'username'),
    )
