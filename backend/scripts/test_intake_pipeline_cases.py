import os
import sys
import io
import json
import logging
from datetime import datetime

# Adjust path to import backend modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from backend.app.database import init_db, engine
from sqlmodel import Session
from backend.app.services.intake_agent import intake_agent
from backend.app.services.intake_service import intake_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_intake")


def make_pdf_bytes(title: str, lines: list) -> bytes:
    """Generate a real valid PDF document in memory using ReportLab."""
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 750, title)
    c.setFont("Helvetica", 10)
    y = 720
    for line in lines:
        c.drawString(50, y, line)
        y -= 20
    c.save()
    return buffer.getvalue()


def run_tests():
    logger.info("Initializing database...")
    init_db()

    results_summary = []

    # ----------------------------------------------------
    # TEST CASE 1: ZERO ATTACHMENTS
    # ----------------------------------------------------
    logger.info("\n=== RUNNING TEST CASE 1: 0 ATTACHMENTS (PURE EMAIL) ===")
    case1_body = (
        "Dear Customer Service,\n\n"
        "I noticed an unauthorized transaction of RM 850.00 on my account ending 4321. "
        "The charge occurred on 05 August 2026 at Online Superstore. I did not perform this payment.\n\n"
        "Regards,\nTan Wei Ming\nAccount: 112233444321\nNRIC: 880512-14-5231"
    )
    case1_subject = "Unauthorized charge dispute RM 850.00"
    case1_sender = "Tan Wei Ming"

    intake1 = intake_agent.process(
        email_body=case1_body,
        email_subject=case1_subject,
        sender_name=case1_sender,
        attachments=[],
        fallback_amount=0.0
    )
    entities1 = intake1["entities"]
    att_names1 = []

    case_obj1 = intake_service.process_incoming_complaint(
        customer_name=entities1["customer_name"],
        customer_email="tan.weiming@email.com",
        account_number=entities1.get("account_number") or "112233444321",
        nric=entities1.get("nric") or "880512-14-5231",
        amount=entities1["amount"],
        email_subject=case1_subject,
        email_body=case1_body,
        attachment_name=att_names1[0] if att_names1 else None,
        attachment_names=att_names1,
        attachment_text=intake1.get("attachment_text"),
        card_number=entities1.get("card_number"),
    )

    with Session(engine) as session:
        session.add(case_obj1)
        session.commit()
        session.refresh(case_obj1)

    r1 = {
        "case_id": case_obj1.id,
        "name": "Case 1 (0 Attachments)",
        "customer": case_obj1.customer_name,
        "amount": case_obj1.amount,
        "attachment_processed": case_obj1.ocr_results["extractedFields"]["attachment_processed"],
        "attachments_list": case_obj1.ocr_results["attachments"],
        "status": case_obj1.status,
    }
    results_summary.append(r1)
    logger.info(f"CASE 1 RESULT: {json.dumps(r1, indent=2)}")

    # ----------------------------------------------------
    # TEST CASE 2: SINGLE PDF ATTACHMENT (1 PDF)
    # ----------------------------------------------------
    logger.info("\n=== RUNNING TEST CASE 2: 1 PDF ATTACHMENT ===")
    pdf2_bytes = make_pdf_bytes(
        "OFFICIAL MERCHANT RECEIPT - TECHSTORE KL",
        [
            "Receipt Number: REC-2026-99120",
            "Date: 2026-08-02",
            "Merchant: TechStore KL (Suria KLCC)",
            "Customer Name: Nurul Aisyah binti Hassan",
            "Dispute Amount: RM 1,450.00",
            "Payment Method: Debit Card Ending 9876",
            "Status: COMPLETED (DUPLICATE ENTRY DETECTED)",
        ]
    )

    attachments2 = [{
        "filename": "TechStore_Receipt_RM1450.pdf",
        "mimeType": "application/pdf",
        "content_bytes": pdf2_bytes
    }]

    case2_body = (
        "Hi,\n\nI was charged twice for RM 1,450.00 at TechStore KL on 02 August 2026. "
        "I have attached the official receipt PDF for your review.\n\n"
        "Nurul Aisyah binti Hassan\nAccount: 554433229876\nNRIC: 920315-10-5432"
    )
    case2_subject = "Double charge billing error RM 1,450.00"
    case2_sender = "Nurul Aisyah binti Hassan"

    intake2 = intake_agent.process(
        email_body=case2_body,
        email_subject=case2_subject,
        sender_name=case2_sender,
        attachments=attachments2,
        fallback_amount=0.0
    )
    entities2 = intake2["entities"]
    att_names2 = [a["filename"] for a in attachments2]

    case_obj2 = intake_service.process_incoming_complaint(
        customer_name=entities2["customer_name"],
        customer_email="nurul.aisyah@email.com",
        account_number=entities2.get("account_number") or "554433229876",
        nric=entities2.get("nric") or "920315-10-5432",
        amount=entities2["amount"],
        email_subject=case2_subject,
        email_body=case2_body,
        attachment_name=att_names2[0] if att_names2 else None,
        attachment_names=att_names2,
        attachment_text=intake2.get("attachment_text"),
        card_number=entities2.get("card_number"),
    )

    with Session(engine) as session:
        session.add(case_obj2)
        session.commit()
        session.refresh(case_obj2)

    r2 = {
        "case_id": case_obj2.id,
        "name": "Case 2 (1 PDF Attachment)",
        "customer": case_obj2.customer_name,
        "amount": case_obj2.amount,
        "attachment_processed": case_obj2.ocr_results["extractedFields"]["attachment_processed"],
        "attachments_list": case_obj2.ocr_results["attachments"],
        "has_extracted_text": bool(case_obj2.ocr_results.get("extracted_text")),
        "status": case_obj2.status,
    }
    results_summary.append(r2)
    logger.info(f"CASE 2 RESULT: {json.dumps(r2, indent=2)}")

    # ----------------------------------------------------
    # TEST CASE 3: MULTIPLE PDF ATTACHMENTS (2 PDFs)
    # ----------------------------------------------------
    logger.info("\n=== RUNNING TEST CASE 3: MULTIPLE PDF ATTACHMENTS (2 PDFs) ===")
    pdf3a_bytes = make_pdf_bytes(
        "POLIS DIRAJA MALAYSIA (PDRM) POLICE REPORT",
        [
            "Report No: RPT/JB/2026/0804/1102",
            "Date: 2026-08-04",
            "Complainant: Subramaniam a/l Krishnan",
            "NRIC: 751104-08-6123",
            "Inciting Incident: Fraudulent ATM Cash Withdrawal",
            "Disputed Amount: RM 3,500.00",
            "Location: ATM Public Bank Johor Bahru",
            "Statement: Complainant states card was in KL while withdrawal occurred in JB.",
        ]
    )

    pdf3b_bytes = make_pdf_bytes(
        "BANK STATEMENT EXCERPT - JULY/AUGUST 2026",
        [
            "Account Number: 998877665544",
            "Account Holder: Subramaniam a/l Krishnan",
            "Transaction Date: 2026-08-04 03:15:22 AM",
            "Transaction Type: ATM WITHDRAWAL JB 0421",
            "Debit Amount: RM 3,500.00",
            "Ledger Balance: RM 12,450.00",
        ]
    )

    attachments3 = [
        {"filename": "PDRM_Police_Report_JB.pdf", "mimeType": "application/pdf", "content_bytes": pdf3a_bytes},
        {"filename": "Bank_Statement_Aug2026.pdf", "mimeType": "application/pdf", "content_bytes": pdf3b_bytes},
    ]

    case3_body = (
        "URGENT,\n\nI am disputing an unauthorized ATM withdrawal of RM 3,500.00 on 04 August 2026. "
        "Attached are the PDRM Police Report and my Bank Statement PDF files.\n\n"
        "Subramaniam a/l Krishnan\nAccount: 998877665544\nNRIC: 751104-08-6123"
    )
    case3_subject = "URGENT: Fraudulent ATM withdrawal RM 3,500.00 with evidence"
    case3_sender = "Subramaniam a/l Krishnan"

    intake3 = intake_agent.process(
        email_body=case3_body,
        email_subject=case3_subject,
        sender_name=case3_sender,
        attachments=attachments3,
        fallback_amount=0.0
    )
    entities3 = intake3["entities"]
    att_names3 = [a["filename"] for a in attachments3]

    case_obj3 = intake_service.process_incoming_complaint(
        customer_name=entities3["customer_name"],
        customer_email="subramaniam@email.com",
        account_number=entities3.get("account_number") or "998877665544",
        nric=entities3.get("nric") or "751104-08-6123",
        amount=entities3["amount"],
        email_subject=case3_subject,
        email_body=case3_body,
        attachment_name=att_names3[0] if att_names3 else None,
        attachment_names=att_names3,
        attachment_text=intake3.get("attachment_text"),
        card_number=entities3.get("card_number"),
    )

    with Session(engine) as session:
        session.add(case_obj3)
        session.commit()
        session.refresh(case_obj3)

    r3 = {
        "case_id": case_obj3.id,
        "name": "Case 3 (2 PDF Attachments)",
        "customer": case_obj3.customer_name,
        "amount": case_obj3.amount,
        "attachment_processed": case_obj3.ocr_results["extractedFields"]["attachment_processed"],
        "attachments_list": case_obj3.ocr_results["attachments"],
        "has_extracted_text": bool(case_obj3.ocr_results.get("extracted_text")),
        "status": case_obj3.status,
    }
    results_summary.append(r3)
    logger.info(f"CASE 3 RESULT: {json.dumps(r3, indent=2)}")

    print("\n" + "=" * 60)
    print("ALL 3 TEST CASES PROCESSED SUCCESSFULLY!")
    print("=" * 60)
    for r in results_summary:
        print(f"[{r['case_id']}] {r['name']}")
        print(f"   Customer: {r['customer']} | Amount: RM {r['amount']}")
        print(f"   Attachment Processed: {r['attachment_processed']}")
        print(f"   Attachments List: {r['attachments_list']}")
        print(f"   Pipeline Status: {r['status']}")
        print("-" * 60)


if __name__ == "__main__":
    run_tests()
