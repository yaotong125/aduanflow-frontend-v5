import hashlib
import pyotp
import io
import base64
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Body, Request, Header
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, or_
from backend.app.database import get_session
from backend.app.models.user import User
from backend.app.models.session import UserSession

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """SHA256 hash for password storage."""
    return hashlib.sha256(password.encode()).hexdigest()


def _find_user_by_username(session: Session, username: str) -> Optional[User]:
    """
    Find a user by username (short name) or full email.
    Supports both 'admin' and 'admin@aduanflow.com' style lookups.
    """
    return session.exec(
        select(User).where(
            or_(
                User.username == username,
                User.email == username,
                User.email == f"{username}@aduanflow.com",
                User.full_name == username,
            )
        )
    ).first()


def _parse_device(user_agent: str) -> Dict[str, str]:
    """Parse User-Agent string into browser + OS labels."""
    try:
        from ua_parser import user_agent_parser
        parsed = user_agent_parser.Parse(user_agent)
        browser = parsed["user_agent"]["family"] or "Unknown Browser"
        os_name = parsed["os"]["family"] or "Unknown OS"
    except Exception:
        browser = "Unknown Browser"
        os_name = "Unknown OS"
        # Fallback manual detection
        ua_lower = (user_agent or "").lower()
        if "edg" in ua_lower:
            browser = "Edge"
        elif "chrome" in ua_lower:
            browser = "Chrome"
        elif "safari" in ua_lower and "chrome" not in ua_lower:
            browser = "Safari"
        elif "firefox" in ua_lower:
            browser = "Firefox"
        elif "opera" in ua_lower or "opr" in ua_lower:
            browser = "Opera"
        if "windows" in ua_lower:
            os_name = "Windows"
        elif "mac" in ua_lower:
            os_name = "macOS"
        elif "linux" in ua_lower:
            os_name = "Linux"
        elif "android" in ua_lower:
            os_name = "Android"
        elif "iphone" in ua_lower or "ipad" in ua_lower:
            os_name = "iOS"

    device_label = f"{browser} on {os_name}"
    return {"browser": browser, "os": os_name, "device_label": device_label}


def _get_client_ip(request: Request) -> str:
    """Extract real client IP honoring proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "Unknown"


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
def login(
    credentials: Dict[str, str],
    request: Request,
    session: Session = Depends(get_session)
):
    username = credentials.get("username", "").strip()
    password = credentials.get("password", "")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    try:
        user = _find_user_by_username(session, username)
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}\n{traceback.format_exc()}")
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.hashed_password != hash_password(password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check password expiry (90 days)
    password_expired = False
    if user.sec_password_expiry and user.password_changed_at:
        days_since = (datetime.utcnow() - user.password_changed_at).days
        if days_since >= 90:
            password_expired = True

    # Check IP Allowlist
    ip = _get_client_ip(request)
    if user.sec_ip_allowlist and user.sec_ip_ranges:
        import ipaddress
        allowed = False
        try:
            client_ip_obj = ipaddress.ip_address(ip)
            ranges = [r.strip() for r in user.sec_ip_ranges.split(",") if r.strip()]
            for r in ranges:
                if client_ip_obj in ipaddress.ip_network(r, strict=False):
                    allowed = True
                    break
        except Exception as e:
            # If parsing fails, deny to be safe
            logger = __import__("logging").getLogger("aduanflow")
            logger.warning(f"IP parse error during allowlist check: {e}")
            
        if not allowed:
            raise HTTPException(status_code=403, detail="Login rejected: Client IP address is not in the allowed network ranges.")

    # Create a real session entry
    ua = request.headers.get("user-agent", "")
    device_info = _parse_device(ua)

    new_session = UserSession(
        user_id=user.id,
        browser=device_info["browser"],
        os=device_info["os"],
        device_label=device_info["device_label"],
        ip_address=ip,
        location="Unknown",  # IP geolocation would require external API
        is_active=True,
        created_at=datetime.utcnow(),
        last_seen_at=datetime.utcnow(),
    )
    session.add(new_session)
    session.commit()
    session.refresh(new_session)

    return {
        "id": user.id,
        "username": user.username,
        "name": user.full_name,
        "role": user.role,
        "email": user.email,
        "session_token": new_session.session_token,
        "requires_2fa": user.sec_2fa,
        "password_expired": password_expired,
    }


# ── TOTP / 2FA ────────────────────────────────────────────────────────────────

@router.post("/2fa/setup/{username}")
def setup_2fa(username: str, session: Session = Depends(get_session)):
    """
    Generate a TOTP secret and return provisioning URI + Base64 QR code PNG.
    The secret is NOT saved to DB yet — only saved after user confirms a valid code.
    """
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Generate a new TOTP secret
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    issuer = "AduanFlow AI"
    provisioning_uri = totp.provisioning_uri(name=user.email, issuer_name=issuer)

    # Build QR code as inline Base64 PNG using segno
    try:
        import segno
        qr = segno.make_qr(provisioning_uri)
        buf = io.BytesIO()
        qr.save(buf, kind="png", scale=6)
        buf.seek(0)
        qr_b64 = base64.b64encode(buf.read()).decode()
    except Exception as e:
        qr_b64 = None

    return {
        "secret": secret,
        "provisioning_uri": provisioning_uri,
        "qr_code_base64": qr_b64,  # data:image/png;base64,<qr_b64>
    }


@router.post("/2fa/confirm/{username}")
def confirm_2fa(username: str, data: Dict[str, str], session: Session = Depends(get_session)):
    """
    Verify a TOTP code against the supplied secret, and if valid, persist the secret to DB.
    """
    secret = data.get("secret", "")
    code = data.get("code", "").strip().replace(" ", "")
    if not secret or not code:
        raise HTTPException(status_code=400, detail="Both 'secret' and 'code' are required")

    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid TOTP code — please try again")

    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.totp_secret = secret
    user.sec_2fa = True
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return {"status": "success", "message": "2FA has been enabled on your account."}


@router.post("/2fa/verify")
def verify_2fa_login(data: Dict[str, str], session: Session = Depends(get_session)):
    """
    Verify TOTP code during login (after password check).
    Called by frontend when requires_2fa=True in login response.
    """
    username = data.get("username", "").strip()
    code = data.get("code", "").strip().replace(" ", "")
    if not username or not code:
        raise HTTPException(status_code=400, detail="username and code are required")

    user = _find_user_by_username(session, username)
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA not configured for this user")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    return {"status": "success", "verified": True}


@router.post("/2fa/disable/{username}")
def disable_2fa(username: str, data: Dict[str, str], session: Session = Depends(get_session)):
    """Disable 2FA after verifying the current TOTP code."""
    code = data.get("code", "").strip()
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.sec_2fa or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA is not currently enabled")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid TOTP code — cannot disable 2FA")

    user.sec_2fa = False
    user.totp_secret = None
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return {"status": "success", "message": "2FA has been disabled."}


# ── Session Management ────────────────────────────────────────────────────────

@router.get("/sessions/{username}")
def list_sessions(username: str, session: Session = Depends(get_session)):
    """List all active sessions for the user."""
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    sessions = session.exec(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.is_active == True
        )
    ).all()

    return [
        {
            "session_token": s.session_token,
            "device_label": s.device_label,
            "browser": s.browser,
            "os": s.os,
            "ip_address": s.ip_address,
            "location": s.location,
            "created_at": s.created_at.isoformat() + "Z",
            "last_seen_at": s.last_seen_at.isoformat() + "Z",
        }
        for s in sessions
    ]


@router.delete("/sessions/{session_token}")
def revoke_session(session_token: str, session: Session = Depends(get_session)):
    """Revoke a specific session by its token."""
    s = session.exec(
        select(UserSession).where(UserSession.session_token == session_token)
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s.is_active = False
    session.add(s)
    session.commit()
    return {"status": "success", "message": "Session revoked."}


@router.post("/sessions/heartbeat")
def session_heartbeat(data: Dict[str, str], request: Request, session: Session = Depends(get_session)):
    """Update last_seen_at for a session token to keep it alive. Also validates active status and IP."""
    token = data.get("session_token", "")
    if not token:
        return {"status": "unauthorized"}
    s = session.exec(
        select(UserSession).where(UserSession.session_token == token, UserSession.is_active == True)
    ).first()
    if s:
        # Check IP if allowlist is enabled for this user
        user = session.get(User, s.user_id)
        if user and user.sec_ip_allowlist and user.sec_ip_ranges:
            ip = _get_client_ip(request)
            import ipaddress
            allowed = False
            try:
                client_ip_obj = ipaddress.ip_address(ip)
                ranges = [r.strip() for r in user.sec_ip_ranges.split(",") if r.strip()]
                for r in ranges:
                    if client_ip_obj in ipaddress.ip_network(r, strict=False):
                        allowed = True
                        break
            except Exception:
                pass
            if not allowed:
                return {"status": "unauthorized"}

        s.last_seen_at = datetime.utcnow()
        session.add(s)
        session.commit()
        return {"status": "ok"}
    return {"status": "unauthorized"}


# ── Password Change ───────────────────────────────────────────────────────────

@router.post("/change-password")
def change_password(data: Dict[str, str], session: Session = Depends(get_session)):
    username = data.get("username", "").strip()
    current_pwd = data.get("current_password", "")
    new_pwd = data.get("new_password", "")

    if not username or not current_pwd or not new_pwd:
        raise HTTPException(status_code=400, detail="All password fields are required")

    user = _find_user_by_username(session, username)
    if not user or user.hashed_password != hash_password(current_pwd):
        raise HTTPException(status_code=401, detail="Invalid current password")

    if len(new_pwd) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    user.hashed_password = hash_password(new_pwd)
    user.password_changed_at = datetime.utcnow()  # Reset expiry clock
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return {"status": "success", "message": "Password updated successfully"}


# ── User Settings ─────────────────────────────────────────────────────────────

@router.get("/settings/{username}")
def get_settings(username: str, session: Session = Depends(get_session)):
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check password expiry
    password_expired = False
    if user.sec_password_expiry and user.password_changed_at:
        days_since = (datetime.utcnow() - user.password_changed_at).days
        if days_since >= 90:
            password_expired = True

    return {
        "displayName": user.full_name,
        "email": user.email,
        "emailEnabled": user.email_enabled,
        "quietHours": user.quiet_hours,
        "checklistState": {
            "2fa": user.sec_2fa,
            "password_expiry": user.sec_password_expiry,
            "ip_allowlist": user.sec_ip_allowlist,
        },
        "notifs": {
            "case_assigned": user.notif_case_assigned,
            "status_changed": user.notif_status_changed,
            "sla_breach": user.notif_sla_breach,
            "manual_review": user.notif_manual_review,
            "weekly_digest": user.notif_weekly_digest,
        },
        "security": {
            "new_device_alert": user.sec_new_device_alert,
            "session_timeout": user.sec_session_timeout,
        },
        "ip_ranges": user.sec_ip_ranges or "",
        "password_expired": password_expired,
    }


@router.post("/settings/{username}")
def update_settings(username: str, settings: Dict[str, Any], session: Session = Depends(get_session)):
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if "displayName" in settings:
        user.full_name = settings["displayName"]
        
    if "email" in settings:
        user.email = settings["email"]
    
    if "emailEnabled" in settings:
        user.email_enabled = settings["emailEnabled"]
    if "quietHours" in settings:
        user.quiet_hours = settings["quietHours"]

    checklist = settings.get("checklistState", {})
    # Note: sec_2fa is controlled via /2fa/confirm and /2fa/disable endpoints
    if "password_expiry" in checklist:
        if checklist["password_expiry"] and not user.sec_password_expiry:
            user.password_changed_at = datetime.utcnow()  # Start expiry clock now
        user.sec_password_expiry = checklist["password_expiry"]
    if "ip_allowlist" in checklist:
        user.sec_ip_allowlist = checklist["ip_allowlist"]

    if "ip_ranges" in settings:
        user.sec_ip_ranges = settings["ip_ranges"]

    notifs = settings.get("notifs", {})
    if "case_assigned" in notifs:
        user.notif_case_assigned = notifs["case_assigned"]
    if "status_changed" in notifs:
        user.notif_status_changed = notifs["status_changed"]
    if "sla_breach" in notifs:
        user.notif_sla_breach = notifs["sla_breach"]
    if "manual_review" in notifs:
        user.notif_manual_review = notifs["manual_review"]
    if "weekly_digest" in notifs:
        user.notif_weekly_digest = notifs["weekly_digest"]

    security = settings.get("security", {})
    if "new_device_alert" in security:
        user.sec_new_device_alert = security["new_device_alert"]
    if "session_timeout" in security:
        user.sec_session_timeout = security["session_timeout"]
    
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return {"status": "success"}


# ── Test Notification ─────────────────────────────────────────────────────────

@router.post("/test-notification/{username}")
def send_test_notification(username: str, session: Session = Depends(get_session)):
    """Send a test email to verify the notification pipeline is working."""
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email_enabled:
        raise HTTPException(status_code=400, detail="Email notifications are disabled for this user.")

    from backend.app.services.communication_service import communication_service
    result = communication_service.send_outbound_email(
        to_email=user.email,
        subject="✅ AduanFlow Test Notification — Email Pipeline Active",
        body=(
            f"Dear {user.full_name},\n\n"
            f"This is a test notification to confirm your AduanFlow email alert pipeline is working correctly.\n\n"
            f"Your current alert preferences are active and emails will be sent to: {user.email}\n\n"
            f"Quiet Hours  : {'Enabled (10 PM–7 AM)' if user.quiet_hours else 'Disabled'}\n"
            f"Case Assigned: {'On' if user.notif_case_assigned else 'Off'}\n"
            f"Status Change: {'On' if user.notif_status_changed else 'Off'}\n"
            f"SLA Breach   : {'On' if user.notif_sla_breach else 'Off'}\n"
            f"Manual Review: {'On' if user.notif_manual_review else 'Off'}\n"
            f"Weekly Digest: {'On' if user.notif_weekly_digest else 'Off'}\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
    )
    return result


# ── Weekly Digest (manual trigger) ────────────────────────────────────────────

@router.post("/send-weekly-digest/{username}")
def trigger_weekly_digest(username: str, session: Session = Depends(get_session)):
    """Manually trigger a weekly digest email for the user."""
    user = _find_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from backend.app.services.notification_service import notification_service
    # Temporarily bypass notif_weekly_digest for manual trigger
    original = user.notif_weekly_digest
    user.notif_weekly_digest = True
    user.email_enabled = True
    delivered = notification_service.send_weekly_digest(user)
    user.notif_weekly_digest = original
    return {
        "status": "sent" if delivered else "recorded",
        "message": f"Weekly digest {'sent' if delivered else 'queued — check Gmail connection'} for {user.email}"
    }
