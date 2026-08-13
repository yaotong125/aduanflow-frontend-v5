"""
Notification Service — fires real email alerts based on per-user preferences.

Triggered by:
  - Case assigned  → send_case_assigned()
  - Status changed → send_status_changed()
  - SLA breach     → send_sla_breach_warning()
  - Manual review  → send_manual_review_queued()
  - Weekly digest  → send_weekly_digest() / send_weekly_digest_to_all()

Respects:
  - email_enabled toggle
  - quiet_hours (no sends between 22:00–07:00 server local time)
"""
import logging
from datetime import datetime, time as dtime
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.app.models.user import User
    from backend.app.models.case import Case

logger = logging.getLogger("aduanflow")


class NotificationService:
    # ── Quiet hours gate ──────────────────────────────────────────────────────

    def _is_quiet_hours(self) -> bool:
        """Returns True if current server time is between 10 PM and 7 AM."""
        now = datetime.now().time()
        return now >= dtime(22, 0) or now < dtime(7, 0)

    def _can_send(self, user: "User") -> bool:
        """Check master email_enabled toggle and quiet hours."""
        if not user.email_enabled:
            return False
        if user.quiet_hours and self._is_quiet_hours():
            logger.info(f"[NotifService] Quiet hours active — skipping notification for {user.email}")
            return False
        return True

    def _dispatch(self, to_email: str, subject: str, body: str) -> bool:
        """Send via the existing communication_service pipeline."""
        try:
            from backend.app.services.communication_service import communication_service
            result = communication_service.send_outbound_email(
                to_email=to_email, subject=subject, body=body
            )
            delivered = result.get("smtp_delivered") or result.get("status") in ("sent", "recorded")
            logger.info(f"[NotifService] Email to {to_email} → status={result.get('status')} smtp={result.get('smtp_delivered')}")
            return delivered
        except Exception as exc:
            logger.error(f"[NotifService] Dispatch error to {to_email}: {exc}")
            return False

    # ── Case Assigned ─────────────────────────────────────────────────────────

    def send_case_assigned(self, user: "User", case: "Case") -> bool:
        if not user.notif_case_assigned or not self._can_send(user):
            return False
        subject = f"📋 Case Assigned: {case.id} — {(case.category or 'dispute').replace('_', ' ').title()}"
        body = (
            f"Dear {user.full_name},\n\n"
            f"A new dispute case has been assigned to you.\n\n"
            f"Case ID    : {case.id}\n"
            f"Customer   : {case.customer_name}\n"
            f"Category   : {(case.category or '').replace('_', ' ').title()}\n"
            f"Amount     : RM {float(case.amount or 0):,.2f}\n"
            f"Urgency    : {case.urgency or 'Normal'}\n"
            f"Received At: {case.received_at}\n\n"
            f"Please log in to AduanFlow to review and action this case.\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
        return self._dispatch(user.email, subject, body)

    # ── Status Changed ────────────────────────────────────────────────────────

    def send_status_changed(
        self, user: "User", case: "Case", old_status: str, new_status: str
    ) -> bool:
        if not user.notif_status_changed or not self._can_send(user):
            return False
        subject = f"🔄 Case Status Update: {case.id} — {old_status} → {new_status}"
        body = (
            f"Dear {user.full_name},\n\n"
            f"A case you are assigned to has had its status updated.\n\n"
            f"Case ID    : {case.id}\n"
            f"Customer   : {case.customer_name}\n"
            f"Old Status : {old_status}\n"
            f"New Status : {new_status}\n"
            f"Updated At : {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
            f"Log in to AduanFlow to review the latest case details.\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
        return self._dispatch(user.email, subject, body)

    # ── SLA Breach Warning ────────────────────────────────────────────────────

    def send_sla_breach_warning(self, user: "User", case: "Case", hours_remaining: float) -> bool:
        if not user.notif_sla_breach or not self._can_send(user):
            return False
        subject = f"⚠️ SLA Breach Warning: {case.id} — {hours_remaining:.1f}h remaining"
        body = (
            f"Dear {user.full_name},\n\n"
            f"URGENT: Case {case.id} is approaching its SLA deadline.\n\n"
            f"Case ID         : {case.id}\n"
            f"Customer        : {case.customer_name}\n"
            f"Category        : {(case.category or '').replace('_', ' ').title()}\n"
            f"Amount          : RM {float(case.amount or 0):,.2f}\n"
            f"Current Status  : {case.status}\n"
            f"SLA Due         : {case.due_date}\n"
            f"Hours Remaining : {hours_remaining:.1f}h\n\n"
            f"Please action this case immediately to avoid an SLA breach.\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
        return self._dispatch(user.email, subject, body)

    # ── Manual Review Queued ──────────────────────────────────────────────────

    def send_manual_review_queued(self, user: "User", case: "Case") -> bool:
        if not user.notif_manual_review or not self._can_send(user):
            return False
        subject = f"🔍 Manual Review Required: {case.id}"
        body = (
            f"Dear {user.full_name},\n\n"
            f"A case has been queued for manual review and requires your attention.\n\n"
            f"Case ID    : {case.id}\n"
            f"Customer   : {case.customer_name}\n"
            f"Category   : {(case.category or '').replace('_', ' ').title()}\n"
            f"Amount     : RM {float(case.amount or 0):,.2f}\n"
            f"Queued At  : {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
            f"Please log in to AduanFlow → Manual Review to investigate.\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
        return self._dispatch(user.email, subject, body)

    # ── Weekly Digest ─────────────────────────────────────────────────────────

    def send_weekly_digest(self, user: "User") -> bool:
        """Build a weekly activity summary from live DB data and email it."""
        if not user.notif_weekly_digest or not user.email_enabled:
            return False
        try:
            from sqlmodel import Session, select, func
            from backend.app.database import engine
            from backend.app.models.case import Case

            with Session(engine) as session:
                total = session.exec(select(func.count(Case.id))).one()
                open_cases = session.exec(
                    select(func.count(Case.id)).where(
                        Case.status.notin_(["FINANCIALLY_RESOLVED", "REJECTED", "CLOSED"])
                    )
                ).one()
                resolved = session.exec(
                    select(func.count(Case.id)).where(
                        Case.status.in_(["FINANCIALLY_RESOLVED", "PASS"])
                    )
                ).one()
                manual_review = session.exec(
                    select(func.count(Case.id)).where(Case.status == "MANUAL_REVIEW")
                ).one()
                high_urgency = session.exec(
                    select(func.count(Case.id)).where(Case.urgency == "HIGH")
                ).one()
                total_amount = session.exec(select(func.sum(Case.amount))).one() or 0.0

        except Exception as exc:
            logger.error(f"[NotifService] Weekly digest DB query failed: {exc}")
            return False

        subject = f"📊 AduanFlow Weekly Digest — {datetime.utcnow().strftime('%d %b %Y')}"
        body = (
            f"Dear {user.full_name},\n\n"
            f"Here is your weekly AduanFlow activity summary:\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"  WEEKLY CASE DIGEST\n"
            f"  {datetime.utcnow().strftime('%A, %d %B %Y')}\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"  Total Cases         : {total}\n"
            f"  Open / Active       : {open_cases}\n"
            f"  Resolved (PASS)     : {resolved}\n"
            f"  In Manual Review    : {manual_review}\n"
            f"  High-Urgency Cases  : {high_urgency}\n"
            f"  Total Dispute Value : RM {float(total_amount):,.2f}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Log in to AduanFlow to review all active cases and take action.\n\n"
            f"Regards,\nAduanFlow AI — Automated Banking Dispute Processing System"
        )
        return self._dispatch(user.email, subject, body)

    def send_weekly_digest_to_all(self):
        """Called by APScheduler — sends digest to every user with notif_weekly_digest=True."""
        try:
            from sqlmodel import Session, select
            from backend.app.database import engine
            from backend.app.models.user import User

            with Session(engine) as session:
                users = session.exec(
                    select(User).where(User.notif_weekly_digest == True, User.email_enabled == True)
                ).all()

            logger.info(f"[NotifService] Sending weekly digest to {len(users)} user(s)...")
            for u in users:
                self.send_weekly_digest(u)
        except Exception as exc:
            logger.error(f"[NotifService] send_weekly_digest_to_all error: {exc}")

    # ── SLA Checker (called by APScheduler hourly) ────────────────────────────

    def check_and_notify_sla_breaches(self):
        """Scan all open cases — alert assigned investigators if SLA ≤ 24h away."""
        try:
            from sqlmodel import Session, select
            from backend.app.database import engine
            from backend.app.models.case import Case
            from backend.app.models.user import User

            now = datetime.utcnow()
            with Session(engine) as session:
                open_cases = session.exec(
                    select(Case).where(
                        Case.status.not_in(["FINANCIALLY_RESOLVED", "REJECTED", "CLOSED", "PASS", "FAIL"])
                    )
                ).all()

                for case in open_cases:
                    if not case.due_date or not case.assigned_to:
                        continue
                    due = case.due_date if isinstance(case.due_date, datetime) else datetime.fromisoformat(str(case.due_date))
                    hours_remaining = (due - now).total_seconds() / 3600
                    if 0 < hours_remaining <= 24:
                        # Find assigned user
                        user = session.exec(
                            select(User).where(
                                (User.full_name == case.assigned_to) |
                                (User.email == case.assigned_to)
                            )
                        ).first()
                        if user:
                            self.send_sla_breach_warning(user, case, hours_remaining)

        except Exception as exc:
            logger.error(f"[NotifService] SLA check error: {exc}")


notification_service = NotificationService()
