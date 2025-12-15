"""
Authentication endpoints: register, login, refresh token.
Implements JWT-based authentication with role-based access control.
"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from .database import get_db
from .models import User, UserRole
from .schemas import UserRegister, UserLogin, Token, TokenRefresh, UserResponse
from .security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_token,
    get_current_user
)
from .logging_config import log_audit_event
from .services.user_service import (
    create_user,
    get_user_by_email,
    get_user_by_username,
    get_user_by_username_or_email,
    update_last_login
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Rate limiting for authentication endpoints (prevent brute force)
limiter = Limiter(key_func=get_remote_address)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")  # Strict limit on registration to prevent spam
async def register_user(
    request: Request,
    user_data: UserRegister,
    db: Session = Depends(get_db)
):
    """
    Register a new user account.
    
    - **email**: Valid email address (unique)
    - **username**: Username (3-50 chars, unique)
    - **password**: Requires upper, lower, and a digit (no min length enforced)
    
    Returns the created user (excluding password).
    """
    # Check if email already exists
    if get_user_by_email(db, user_data.email):
        log_audit_event(
            "registration_failed",
            user_id=None,
            action="register",
            details={"email": user_data.email, "reason": "email_exists"},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username already exists
    if get_user_by_username(db, user_data.username):
        log_audit_event(
            "registration_failed",
            user_id=None,
            action="register",
            details={"username": user_data.username, "reason": "username_exists"},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Create new user (first user is admin, rest are regular users)
    user_count = db.query(User).count()
    is_first_user = user_count == 0
    
    new_user = create_user(
        db,
        email=user_data.email,
        username=user_data.username,
        password=user_data.password,
        role=UserRole.ADMIN if is_first_user else UserRole.USER
    )
    
    log_audit_event(
        "user_registered",
        user_id=new_user.id,
        action="register",
        details={"username": new_user.username, "role": new_user.role.value},
        status="success"
    )
    
    logger.info(f"New user registered: {new_user.username} (role: {new_user.role.value})")
    
    return new_user


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")  # Prevent brute force login attempts
async def login(
    request: Request,
    login_data: UserLogin,
    db: Session = Depends(get_db)
):
    """
    Authenticate user and return JWT tokens.
    
    - **username**: Username or email
    - **password**: User password
    
    Returns access token (short-lived, 15 min) and refresh token (long-lived, 7 days).
    """
    # Find user by username or email
    user = get_user_by_username_or_email(db, login_data.username)
    
    # Verify password
    if not user or not verify_password(login_data.password, user.hashed_password):
        log_audit_event(
            "login_failed",
            user_id=user.id if user else None,
            action="login",
            details={"username": login_data.username, "reason": "invalid_credentials"},
            status="failed"
        )
        # Generic error message to prevent user enumeration
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        log_audit_event(
            "login_failed",
            user_id=user.id,
            action="login",
            details={"username": user.username, "reason": "account_inactive"},
            status="failed"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive"
        )
    
    # Update last login timestamp
    update_last_login(db, user.id)
    
    # Create tokens with user info
    token_data = {
        "sub": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role.value
    }
    
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    log_audit_event(
        "user_login",
        user_id=user.id,
        action="login",
        details={"username": user.username},
        status="success"
    )
    
    logger.info(f"User logged in: {user.username}")
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/refresh", response_model=Token)
@limiter.limit("20/minute")
async def refresh_access_token(
    request: Request,
    token_data: TokenRefresh,
    db: Session = Depends(get_db)
):
    """
    Refresh access token using a valid refresh token.
    
    - **refresh_token**: Valid refresh token
    
    Returns a new access token and refresh token pair.
    """
    # Verify refresh token
    payload = verify_token(token_data.refresh_token, token_type="refresh")
    user_id = payload.get("sub")
    
    # Verify user still exists and is active
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    
    # Create new tokens
    token_data_dict = {
        "sub": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role.value
    }
    
    new_access_token = create_access_token(token_data_dict)
    new_refresh_token = create_refresh_token(token_data_dict)
    
    logger.info(f"Token refreshed for user: {user.username}")
    
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer"
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get current authenticated user's information.
    
    Requires valid JWT access token in Authorization header.
    """
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user
