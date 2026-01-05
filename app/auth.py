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
from .config import get_settings
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
settings = get_settings()
if settings.rate_limit_enabled:
    limiter = Limiter(key_func=get_remote_address)
else:
    class NoOpLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    limiter = NoOpLimiter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
# @limiter.limit("5/hour")  # Strict limit on registration to prevent spam
async def register_user(
    request: Request,
    user_data: UserRegister,
    db: Session = Depends(get_db)
):
    logger.info(f"Registering user: {user_data.username}")
    """
    Register a new user account.
    
    - **email**: Valid email address (unique)
    - **username**: Username (3-50 chars, unique)
    - **password**: Requires upper, lower, and a digit (no min length enforced)
    
    Returns the created user (excluding password).
    
    User role assignment:
    1. If email is in ADMIN_EMAILS environment variable → admin
    2. Else if this is the first user → admin
    3. Else → regular user
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
    
    # Determine user role based on admin email configuration and user count
    settings = get_settings()
    admin_emails_list = [email.strip().lower() for email in settings.admin_emails.split(',') if email.strip()]
    
    # Check if this email is in the admin emails list
    is_admin_email = user_data.email.lower() in admin_emails_list
    
    # Fall back to first user logic if no admin emails configured
    is_first_user = db.query(User).count() == 0
    
    user_role = UserRole.ADMIN if (is_admin_email or is_first_user) else UserRole.USER
    
    new_user = create_user(
        db,
        email=user_data.email,
        username=user_data.username,
        password=user_data.password,
        role=user_role
    )
    
    log_audit_event(
        "user_registered",
        user_id=new_user.id,
        action="register",
        details={"username": new_user.username, "role": new_user.role.value, "admin_email_match": is_admin_email},
        status="success"
    )
    
    logger.info(f"New user registered: {new_user.username} (role: {new_user.role.value})")
    
    return new_user


@router.post("/login", response_model=Token)
# @limiter.limit("10/minute")  # Prevent brute force login attempts
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


# Admin Management Endpoints

@router.post("/admin/promote/{user_id}", response_model=UserResponse)
async def promote_user_to_admin(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Promote a user to admin role. Only admins can perform this action.
    
    - **user_id**: UUID of the user to promote
    
    Returns the updated user.
    """
    # Check if current user is admin
    admin = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not admin or admin.role != UserRole.ADMIN:
        log_audit_event(
            "admin_promotion_failed",
            user_id=current_user["user_id"],
            action="promote_to_admin",
            details={"target_user_id": user_id, "reason": "unauthorized"},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can promote users"
        )
    
    # Find the user to promote
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Promote to admin
    user.role = UserRole.ADMIN
    db.commit()
    db.refresh(user)
    
    log_audit_event(
        "user_promoted_to_admin",
        user_id=current_user["user_id"],
        resource_id=user_id,
        action="promote_to_admin",
        details={"promoted_user": user.username},
        status="success"
    )
    
    logger.info(f"User {user.username} promoted to admin by {admin.username}")
    
    return user


@router.post("/admin/demote/{user_id}", response_model=UserResponse)
async def demote_user_from_admin(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Demote an admin user to regular user role. Only admins can perform this action.
    
    - **user_id**: UUID of the admin to demote
    
    Returns the updated user.
    """
    # Check if current user is admin
    admin = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not admin or admin.role != UserRole.ADMIN:
        log_audit_event(
            "admin_demotion_failed",
            user_id=current_user["user_id"],
            action="demote_from_admin",
            details={"target_user_id": user_id, "reason": "unauthorized"},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can demote users"
        )
    
    # Find the user to demote
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent demoting the last admin
    admin_count = db.query(User).filter(User.role == UserRole.ADMIN).count()
    if user.role == UserRole.ADMIN and admin_count == 1:
        log_audit_event(
            "admin_demotion_failed",
            user_id=current_user["user_id"],
            action="demote_from_admin",
            details={"target_user_id": user_id, "reason": "last_admin"},
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot demote the last remaining admin"
        )
    
    # Demote to regular user
    user.role = UserRole.USER
    db.commit()
    db.refresh(user)
    
    log_audit_event(
        "user_demoted_from_admin",
        user_id=current_user["user_id"],
        resource_id=user_id,
        action="demote_from_admin",
        details={"demoted_user": user.username},
        status="success"
    )
    
    logger.info(f"User {user.username} demoted from admin by {admin.username}")
    
    return user


@router.get("/admin/users", response_model=list[UserResponse])
async def list_all_users(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all users. Only admins can access this endpoint.
    
    Returns a list of all users in the system.
    """
    # Check if current user is admin
    admin = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not admin or admin.role != UserRole.ADMIN:
        log_audit_event(
            "user_list_access_denied",
            user_id=current_user["user_id"],
            action="list_users",
            status="rejected"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can list users"
        )
    
    users = db.query(User).all()
    return users
