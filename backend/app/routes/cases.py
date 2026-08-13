from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from typing import List, Optional
import os
import logging
from datetime import datetime
from backend.app.database import get_session
from backend.app.models.case import Case, CaseUpdate

logger = logging.getLogger("aduanflow")

router = APIRouter(prefix="/cases", tags=["cases"])

@router.get("/downloads/{filename}")
def download_sample_pdf(filename: str):
    """Download sample PDF evidence file."""
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    paths = [
        os.path.join(base_dir, "frontend", "public", "downloads", filename),
        os.path.join(base_dir, "backend", "test_samples", filename),
    ]
    for p in paths:
        if os.path.exists(p):
            return FileResponse(path=p, filename=filename, media_type="application/pdf")
    raise HTTPException(status_code=404, detail=f"File {filename} not found")

def format_case(c: Case) -> dict:
    return {
        "id": c.id,
        "customerName": c.customer_name,
        "customerEmail": c.customer_email,
        "maskedAccount": c.masked_account,
        "category": c.category,
        "urgency": c.urgency,
        "status": c.status,
        "verificationResult": c.verification_result or c.status,
        "amount": c.amount,
        "assignedTo": c.assigned_to,
        "receivedAt": c.received_at.isoformat() if hasattr(c.received_at, 'isoformat') else str(c.received_at),
        "dueDate": c.due_date.isoformat() if (c.due_date and hasattr(c.due_date, 'isoformat')) else None,

        "processingTime": c.processing_time or "—",
        "emailSubject": c.email_subject,
        "emailBody": c.email_body,
        "ocrResults": c.ocr_results,
        "classification": c.classification,
        "verification": c.verification,
        "financialResolution": c.financial_resolution,
        "communication": c.communication,
        "auditLog": c.audit_log or [],
    }

@router.get("")
def list_cases(
    status: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """List dispute cases with filtering and search."""
    statement = select(Case)
    if status:
        statement = statement.where(Case.status == status)
    if category:
        statement = statement.where(Case.category == category)
    
    results = session.exec(statement).all()
    
    if search:
        s = search.lower()
        results = [
            c for c in results 
            if s in c.id.lower() or s in c.customer_name.lower() or s in c.customer_email.lower()
        ]
        
    return [format_case(c) for c in results]

@router.get("/{case_id}")
def get_case(case_id: str, session: Session = Depends(get_session)):
    """Get a single dispute case details."""
    case_item = session.get(Case, case_id)
    if not case_item:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return format_case(case_item)

@router.patch("/{case_id}")
def update_case(case_id: str, case_update: CaseUpdate, session: Session = Depends(get_session)):
    """Update case status, assignment, or resolution."""
    try:
        db_case = session.get(Case, case_id)
        if not db_case:
            raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
            
        case_data = case_update.model_dump(exclude_unset=True)
        for key, value in case_data.items():
            setattr(db_case, key, value)

        # Handle outbound email dispatch & metadata updates for investigator actions
        if case_update.status or case_update.verification_result:
            action_status = case_update.status or db_case.status
            current_comm = dict(db_case.communication or {})
            emails_list = list(current_comm.get("emails", []))

            safe_name = str(db_case.customer_name or "Customer")
            safe_amt = float(db_case.amount or 0.0)
            safe_cat = str(db_case.category or "dispute").replace("_", " ").title()

            subject = ""
            body = ""
            action_label = ""

            if action_status in ['PASS', 'FINANCIALLY_RESOLVED']:
                action_label = "Resolution Approved"
                subject = f"Resolution Notice: Dispute Case {db_case.id} Approved & Credit Posted"
                body = (
                    f"Dear {safe_name},\n\n"
                    f"Great news! Your dispute case {db_case.id} regarding {safe_cat} of RM {safe_amt:,.2f} "
                    f"has been reviewed and approved by our dispute team. A credit adjustment has been posted to your account.\n\n"
                    f"Mandatory BNM & FMOS Disclosures:\n"
                    f"1. BNM Policy Document on Complaints Handling: Processed within SLA mandate.\n"
                    f"2. FMOS Redress Notice: Should you remain dissatisfied, you may refer your case to FMOS within 6 months.\n\n"
                    f"Regards,\nAduanFlow Dispute Automation Team"
                )
            elif action_status in ['FAIL', 'REJECTED']:
                action_label = "Claim Declined"
                subject = f"Resolution Notice: Dispute Case {db_case.id} Claim Declined"
                body = (
                    f"Dear {safe_name},\n\n"
                    f"We have completed our investigation of dispute case {db_case.id} regarding RM {safe_amt:,.2f}. "
                    f"Based on core system logs and transaction verification, your dispute claim has been declined.\n\n"
                    f"Mandatory BNM & FMOS Disclosures:\n"
                    f"1. BNM Policy Document on Complaints Handling: Decision rendered in accordance with banking guidelines.\n"
                    f"2. FMOS Redress Notice: If you wish to appeal or present new evidence, you may refer your case to FMOS within 6 months.\n\n"
                    f"Regards,\nAduanFlow Dispute Automation Team"
                )
            elif action_status == 'MANUAL_REVIEW':
                action_label = "Additional Details Requested"
                subject = f"Action Required: Additional Information Requested for Dispute Case {db_case.id}"
                body = (
                    f"Dear {safe_name},\n\n"
                    f"Our dispute team is currently reviewing your case {db_case.id} regarding RM {safe_amt:,.2f}. "
                    f"To proceed with verification, please reply to this email with additional supporting documentation (e.g. merchant receipt, police report, or bank statement).\n\n"
                    f"Your case is maintained under MANUAL_REVIEW status while awaiting your response.\n\n"
                    f"Regards,\nAduanFlow Dispute Automation Team"
                )

            if subject and body and db_case.customer_email:
                new_email_entry = {
                    "type": action_status,
                    "subject": subject,
                    "body": body,
                    "sentAt": datetime.utcnow().isoformat() + "Z",
                    "recipient": db_case.customer_email,
                    "actionLabel": action_label,
                    "status": "DELIVERED",
                }
                # Stack most recent email at top (index 0)
                emails_list.insert(0, new_email_entry)
                current_comm["emails"] = emails_list
                current_comm["finalResponse"] = {"subject": subject, "body": body, "sentAt": new_email_entry["sentAt"]}
                db_case.communication = dict(current_comm)

                # Append audit entry to case JSON and persist row in audit_logs table
                from backend.app.models.audit import AuditLog
                audit_action = f"Action Executed: {action_label}"
                audit_detail = f"Outbound email dispatched to {db_case.customer_email} | Status: {action_status}"

                current_audit = list(db_case.audit_log or [])
                current_audit.append({
                    "time": datetime.utcnow().isoformat() + "Z",
                    "actor": "Human Investigator",
                    "action": audit_action,
                    "detail": audit_detail
                })
                db_case.audit_log = current_audit

                session.add(AuditLog(
                    case_id=db_case.id,
                    actor="Human Investigator",
                    action=audit_action,
                    detail=audit_detail
                ))

                # Dispatch outbound email safely
                try:
                    from backend.app.services.communication_service import communication_service
                    communication_service.send_outbound_email(
                        to_email=db_case.customer_email,
                        subject=subject,
                        body=body
                    )
                except Exception as err:
                    logger.warning(f"[CasesRoute] Error dispatching update email: {err}")

                # ── Fire investigator notification alerts ──
                try:
                    from backend.app.services.notification_service import notification_service
                    from backend.app.models.user import User
                    from sqlmodel import or_ as sql_or

                    if db_case.assigned_to:
                        notif_user = session.exec(
                            select(User).where(
                                sql_or(
                                    User.full_name == db_case.assigned_to,
                                    User.email == db_case.assigned_to,
                                )
                            )
                        ).first()
                        if notif_user:
                            old_status = case_data.get("status", db_case.status) or db_case.status
                            notification_service.send_status_changed(
                                notif_user, db_case, old_status, action_status
                            )
                            if action_status == "MANUAL_REVIEW":
                                notification_service.send_manual_review_queued(notif_user, db_case)
                except Exception as notif_err:
                    logger.warning(f"[CasesRoute] Notification dispatch error: {notif_err}")

        session.add(db_case)
        session.commit()
        session.refresh(db_case)
        return format_case(db_case)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CasesRoute] PATCH error for case {case_id}: {e}")
        try:
            session.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Case update error: {str(e)}")


@router.post("/delete-by-customer")
def delete_cases_by_customer(data: dict, session: Session = Depends(get_session)):
    """Delete all case records matching a customer name query."""
    name_query = data.get("name", "").strip()
    if not name_query:
        raise HTTPException(status_code=400, detail="Name parameter required")
    
    cases = session.exec(select(Case).where(Case.customer_name.like(f"%{name_query}%"))).all()
    count = len(cases)
    for c in cases:
        session.delete(c)
    session.commit()
    return {"status": "success", "deleted_count": count, "message": f"Deleted {count} cases matching '{name_query}'."}


@router.delete("/{case_id}")
def delete_case(case_id: str, session: Session = Depends(get_session)):
    """Delete a single case record by case ID."""
    db_case = session.exec(select(Case).where(Case.id == case_id)).first()
    if not db_case:
        raise HTTPException(status_code=404, detail="Case not found")
    
    session.delete(db_case)
    session.commit()
    return {"status": "success", "message": f"Case {case_id} deleted successfully."}
