"""
User service - business logic for user management.
"""
from sqlalchemy.orm import Session
from typing import Optional
import uuid

from ..models import User, UserRole
from ..security import get_password_hash


def create_user(
    db: Session,
    email: str,
    username: str,
    password: str,
    role: UserRole = UserRole.USER
) -> User:
    """Create a new user with hashed password."""
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        username=username,
        hashed_password=get_password_hash(password),
        role=role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_id(db: Session, user_id: str) -> Optional[User]:
    """Get user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get user by email."""
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get user by username."""
    return db.query(User).filter(User.username == username).first()


def get_user_by_username_or_email(db: Session, identifier: str) -> Optional[User]:
    """Get user by username OR email."""
    return db.query(User).filter(
        (User.username == identifier) | (User.email == identifier)
    ).first()


def update_last_login(db: Session, user_id: str) -> None:
    """Update user's last login timestamp."""
    from datetime import datetime
    user = get_user_by_id(db, user_id)
    if user:
        user.last_login = datetime.utcnow()
        db.commit()


def deactivate_user(db: Session, user_id: str) -> bool:
    """Deactivate a user account."""
    user = get_user_by_id(db, user_id)
    if user:
        user.is_active = False
        db.commit()
        return True
    return False
