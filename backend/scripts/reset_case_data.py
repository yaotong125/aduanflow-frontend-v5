import os
import sys
import logging

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sqlmodel import Session, select
from backend.app.database import engine, init_db
from backend.app.models.case import Case
from backend.app.models.audit import AuditLog
from backend.app.models.settings import SystemSettings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reset_data")

def reset_cases_only():
    logger.info("Initializing DB connection...")
    init_db()

    with Session(engine) as session:
        # Verify SystemSettings exist & print status
        settings = session.exec(select(SystemSettings)).all()
        logger.info(f"SystemSettings records preserved: {len(settings)}")
        for s in settings:
            logger.info(f" -> Setting ID: {s.id} | Gmail Connected: {s.is_gmail_connected} | Email: {s.gmail_email}")

        # Delete dispute_cases & audit_logs
        c_count = session.query(Case).delete()
        a_count = session.query(AuditLog).delete()
        session.commit()

        logger.info("=================================================")
        logger.info(f"RESET COMPLETE:")
        logger.info(f" - Deleted {c_count} rows from dispute_cases table.")
        logger.info(f" - Deleted {a_count} rows from audit_logs table.")
        logger.info(f" - System & User Settings preserved intact.")
        logger.info("=================================================")

if __name__ == "__main__":
    reset_cases_only()
