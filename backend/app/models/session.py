from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
import uuid


class UserSession(SQLModel, table=True):
    """
    Tracks real login sessions per user — browser, device, IP, last-seen.
    Created on login, revoked individually or all-at-once on password change.
    """
    __tablename__ = "user_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    session_token: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        index=True,
        unique=True
    )

    # Device / browser info parsed from User-Agent
    browser: str = Field(default="Unknown Browser")
    os: str = Field(default="Unknown OS")
    device_label: str = Field(default="Unknown Device")  # e.g. "Chrome on Windows"

    # Network info
    ip_address: str = Field(default="Unknown")
    location: str = Field(default="Unknown")  # Best-effort from IP

    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)
