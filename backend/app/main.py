import os
import json
import logging
import pathlib
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from dotenv import load_dotenv

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

# Load .env at the very earliest point so all service modules read configured credentials
_dotenv_path = pathlib.Path(__file__).resolve().parents[1] / ".env"
if not _dotenv_path.exists():
    _dotenv_path = pathlib.Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=_dotenv_path.as_posix())

from backend.app.config import settings
from backend.app.database import init_db, engine
from backend.app.models.case import Case
from backend.app.models.audit import AuditLog
from backend.app.models.session import UserSession  # register table for init_db
from backend.app.routes import cases, audit, copilot, intake, taskforce, webhooks, auth
from backend.app.routes import settings as settings_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('aduanflow')

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    logger.info('Initializing Database...')
    init_db()
    
    import threading
    threading.Thread(target=seed_database, daemon=True, name="SeedDatabaseThread").start()

    # Start autonomous Gmail background poller so complaints are processed automatically
    from backend.app.services.gmail_sync_agent import gmail_sync_agent
    poll_interval = int(os.getenv("GMAIL_POLL_INTERVAL", "30"))
    gmail_sync_agent.start_background_sync_loop(interval_seconds=poll_interval)
    logger.info(f'Gmail auto-sync worker started (poll every {poll_interval}s).')

    # ── APScheduler: SLA breach checker (hourly) + Weekly digest (Monday 08:00) ──
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from backend.app.services.notification_service import notification_service

        scheduler = BackgroundScheduler(timezone="Asia/Kuala_Lumpur")

        # Hourly SLA breach scanner
        scheduler.add_job(
            notification_service.check_and_notify_sla_breaches,
            trigger="interval",
            hours=1,
            id="sla_breach_checker",
            name="Hourly SLA Breach Checker",
            replace_existing=True,
        )

        # Weekly digest — every Monday at 08:00 MYT
        scheduler.add_job(
            notification_service.send_weekly_digest_to_all,
            trigger=CronTrigger(day_of_week="mon", hour=8, minute=0),
            id="weekly_digest",
            name="Weekly Digest Mailer",
            replace_existing=True,
        )

        scheduler.start()
        logger.info("APScheduler started: SLA checker (hourly) + Weekly digest (Mon 08:00 MYT)")
    except Exception as sched_err:
        logger.warning(f"APScheduler could not start: {sched_err}")

    yield
    # Shutdown cleanup (if needed)
    logger.info('AduanFlow shutdown complete.')

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)

# CORS: allow_origins=['*'] with allow_credentials=True is rejected by browsers (CORS spec §3.2).
# We read the frontend URL from env; fall back to common local-dev + known Render URLs.
_frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
_allowed_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "https://aduanflow-frontend-v4.onrender.com",
    "https://aduanflow-frontend-v5.onrender.com",
    "https://aduanflow-frontend.onrender.com",
    "https://aduanflow-frontend-v2.onrender.com",
    "https://aduanflow-frontend-v3.onrender.com",
]
if _frontend_url and _frontend_url not in _allowed_origins:
    _allowed_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
    )

app.include_router(cases.router, prefix=settings.API_V1_STR)
app.include_router(audit.router, prefix=settings.API_V1_STR)
app.include_router(copilot.router, prefix=settings.API_V1_STR)
app.include_router(intake.router, prefix=settings.API_V1_STR)
app.include_router(taskforce.router, prefix=settings.API_V1_STR)
app.include_router(webhooks.router, prefix=settings.API_V1_STR)
app.include_router(settings_router.router, prefix=settings.API_V1_STR)
app.include_router(auth.router, prefix=settings.API_V1_STR)
from backend.app.routes import mcp
app.include_router(mcp.router)

@app.get("/api/db-status")
def check_db_status():
    from backend.app.database import engine, db_url, get_db_error
    err_trace = get_db_error()
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            res = conn.execute(text("SELECT 1")).scalar()
            from backend.app.database import init_db
            init_db()
        return {
            "status": "connected",
            "engine_url": str(engine.url),
            "db_type": "postgresql" if "postgresql" in str(engine.url) else "sqlite",
            "connection_error": err_trace
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "engine_url": str(engine.url),
            "connection_error": err_trace
        }



def seed_database():
    """Seed initial mock cases and default admin user if tables are empty."""
    with Session(engine) as session:
        # 1. Seed Default Admin User if no users exist
        from backend.app.models.user import User
        from backend.app.routes.auth import hash_password
        existing_user = session.exec(select(User)).first()
        if not existing_user:
            admin_user = User(
                username="admin",
                email="admin@aduanflow.com",
                full_name="System Administrator",
                role="admin",
                hashed_password=hash_password("admin123")
            )
            session.add(admin_user)
            try:
                session.commit()
                logger.info("Seeded default admin user (admin@aduanflow.com).")
            except Exception as e:
                session.rollback()
                logger.error(f"Failed to seed admin user: {e}")

        # 2. Ensure SystemSettings is auto-seeded & connected on startup
        from backend.app.models.settings import SystemSettings
        from backend.app.services.encryption_service import encryption_service

        raw_token = os.getenv("GMAIL_REFRESH_TOKEN")
        if raw_token:
            settings_obj = session.get(SystemSettings, "global_settings")
            if not settings_obj or not settings_obj.is_gmail_connected:
                if not settings_obj:
                    settings_obj = SystemSettings(id="global_settings")
                target_email = os.getenv("GMAIL_EMAIL")
                if target_email:
                    settings_obj.gmail_email = target_email
                    settings_obj.gmail_refresh_token_encrypted = encryption_service.encrypt(raw_token)
                    settings_obj.is_gmail_connected = True
                    settings_obj.updated_at = datetime.utcnow()
                    session.add(settings_obj)
                    try:
                        session.commit()
                        logger.info("Seeded SystemSettings with GMAIL_REFRESH_TOKEN.")
                    except Exception as e:
                        session.rollback()
                        logger.error(f"Failed to seed SystemSettings: {e}")

@app.get('/')
def root():
    return {'message': 'AduanFlow AI Backend API is running', 'docs': '/docs'}


@app.post('/api/debug/sync')
def debug_sync():
    """Manually trigger one Gmail sync cycle and return the raw result/error."""
    import traceback
    from backend.app.services.gmail_sync_agent import gmail_sync_agent
    try:
        result = gmail_sync_agent.run_sync_cycle()
        return {"ok": True, "result": result}
    except Exception as e:
        return {"ok": False, "error": str(e), "traceback": traceback.format_exc()}


@app.post('/api/debug/smtp')
def debug_smtp():
    """Test outbound SMTP connectivity from the server (the actual render instance)."""
    import os, socket, smtplib, traceback
    from dotenv import load_dotenv
    out = {"host": "smtp.gmail.com", "port": 587, "dns_ok": None, "tcp_ok": None, "starttls_ok": None, "smtp_auth_ok": None, "has_password": False}
    try:
        try:
            ip = socket.gethostbyname("smtp.gmail.com")
            out["dns_ok"] = ip
        except Exception as e:
            out["dns_error"] = str(e)
        try:
            s = socket.create_connection(("smtp.gmail.com", 587), timeout=8)
            out["tcp_ok"] = True
            s.close()
        except Exception as e:
            out["tcp_ok"] = False
            out["tcp_error"] = repr(e)
        # Retry forcing IPv4 via an explicit IPv4 sockaddr (bypasses IPv6 socket attempts)
        out["tcp4_ok"] = None
        try:
            s4 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s4.settimeout(8)
            s4.connect(("173.194.202.108", 587))
            out["tcp4_ok"] = True
            s4.close()
        except Exception as e:
            out["tcp4_ok"] = False
            out["tcp4_error"] = repr(e)
        pw = os.getenv("GMAIL_APP_PASSWORD")
        if not pw:
            try:
                from sqlmodel import Session
                from backend.app.database import engine
                from backend.app.models.settings import SystemSettings
                from backend.app.services.encryption_service import encryption_service
                with Session(engine) as session:
                    so = session.get(SystemSettings, "global_settings")
                    if so and so.gmail_app_password_encrypted:
                        pw = encryption_service.decrypt(so.gmail_app_password_encrypted)
            except Exception:
                pass
        out["has_password"] = bool(pw)
        try:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=8)
            server.ehlo()
            server.starttls()
            out["starttls_ok"] = True
        except Exception as e:
            out["starttls_ok"] = False
            out["starttls_error"] = repr(e)
        return {"ok": True, "result": out}
    except Exception as e:
        return {"ok": False, "error": str(e), "traceback": traceback.format_exc()}
