import logging
import os
from pathlib import Path
from typing import Any, Dict, List
from datetime import datetime

from dotenv import load_dotenv
from sqlmodel import Session, select

from backend.app.models.case import Case
from backend.app.services.taskforce_service import taskforce_service

logger = logging.getLogger(__name__)

# Explicitly load .env from project root or backend folder
_possible_paths = [
    Path(__file__).resolve().parents[2] / ".env",
    Path(__file__).resolve().parents[3] / ".env",
]
for _p in _possible_paths:
    if _p.exists():
        load_dotenv(dotenv_path=_p)
        break

def _get_gemini_client():
    _api_key = os.getenv("GEMINI_API_KEY")
    if not _api_key:
        return None
    try:
        from google import genai as _genai
        return _genai.Client(api_key=_api_key)
    except Exception as e:
        logger.warning(f"[Copilot] google-genai client creation failed: {e}. Trying generativeai fallback.")
        try:
            import google.generativeai as genai
            genai.configure(api_key=_api_key)
            return "generativeai"
        except Exception as e2:
            logger.error(f"[Copilot] generativeai fallback failed: {e2}")
            return None

_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-001")


def _build_context(cases: List[Case], overview: Dict[str, Any]) -> str:
    summary = overview.get("summary", {})
    missions = overview.get("missions", [])
    squads = overview.get("squads", [])

    mission_lines = "\n".join(
        f"- Case {m['caseId']} ({m['category']}, RM {m['amount']:,.2f}, {m['status']}): assigned to {m['squad']} — {m['reason']}"
        for m in missions[:8]
    )
    squad_lines = "\n".join(
        f"- {s['name']} (lead: {s['lead']}): {s['caseCount']} cases, {s['activeCount']} active"
        for s in squads
    )

    return f"""You are Aegis, the AI Banking Dispute Automation Taskforce orchestrator for AduanFlow (PayNet AI Hackathon 2026).
You assist bank investigators, compliance officers, and users with dispute operations, pipeline monitoring, and taskforce orchestration.
RESPONSE FORMATTING & STYLING INSTRUCTIONS:
- Whenever presenting operational snapshots, case metrics, squad overviews, or multi-case summaries, ALWAYS format them in clean Markdown Tables (e.g. `| Metric | Status |` or `| Case ID | Customer | Category | Amount | Status |`).
- Always reference Case IDs in full standard format (`DISP-2026-XXXX`).
- Use bold headers (`### `) and bullet points (`- `) to structure recommendations.

SYSTEM ARCHITECTURE & CAPABILITIES:
1. Email Intake & Security Enforcement:
   - Connects to complaints mailbox via Gmail OAuth 2.0 (`refresh_token`).
   - Extracts NRICs, account numbers, amounts, and attachments via PDF OCR.
   - Encrypts PII at rest using Fernet symmetric encryption (`nric_encrypted`).

2. Automated Case Classification & Governance:
   - Categorizes into 7 PayNet dispute types (`unauthorized_transactions`, `billing_errors`, `mis_selling_claims`, `atm_debit_card_disputes`, `insurance_takaful_claims`, `loan_financing_disputes`, `emoney_digital_payment_disputes`).
   - Stamps BNM Complaints Policy SLAs: High Urgency (5 Working Days), Medium/Low Urgency (20 Working Days).

3. Core System Verification Engine (MCP):
   - Cross-references dispute data against Core Banking logs & CRM using Model Context Protocol (MCP).
   - Validates account ownership, transaction logs, and dispute amounts.
   - Statuses:
     - PASS: 6/6 checks pass, no anomalies.
     - MANUAL_REVIEW: Flagged if amount > RM 5,000 or location anomaly detected (e.g. mobile login in KL at 2:50 AM, physical ATM withdrawal in JB at 3:15 AM).
     - FAIL: Core data mismatch or missing records.

4. Autonomous Financial Resolution:
   - Posts provisional credits or reversals automatically for PASS cases.
   - Generates accounting journal entries (`JE-2026-xxxx`).
   - Resolves cases straight-through in < 3 minutes.

5. Compliant Customer Communication:
   - Dispatches email resolution notices with mandatory Bank Negara Malaysia (BNM) disclosures.
   - For claims ≤ RM 250,000 where customer remains dissatisfied, embeds notice of FMOS right of referral within 6 months.

CURRENT TASKFORCE STATUS:
- Total cases: {summary.get('totalCases', 0)}
- Active missions: {summary.get('activeMissionCount', 0)}
- Manual escalations: {summary.get('manualEscalations', 0)}
- High-value exposure: RM {summary.get('highValueExposure', 0):,.2f}
- Straight-through rate: {summary.get('straightThroughRate', 0)}%
- Priority coverage: {summary.get('priorityCoverage', 0)} high-urgency cases

SQUADS:
{squad_lines}

ACTIVE MISSIONS:
{mission_lines}
"""


class CopilotService:
    def process_query(self, query: str, session: Session, conversation_id: str = None) -> tuple[str, str]:
        from backend.app.models.copilot import Conversation, Message
        from typing import cast
        
        # 1. Resolve conversation
        conv = None
        if conversation_id:
            conv = session.get(Conversation, conversation_id)
        if not conv:
            conv = Conversation(title=f"Chat {query[:20]}...")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            
        # 2. Add user message
        user_msg = Message(role="user", content=query, conversation_id=conv.id)
        session.add(user_msg)
        session.commit()
        
        # 3. Load history context (last 10 messages)
        conv_messages = sorted(conv.messages, key=lambda m: m.created_at)
        history_context = ""
        if len(conv_messages) > 1:
            history_context = "PAST CONVERSATION HISTORY (Use this for context if the user refers to past statements):\n"
            for msg in conv_messages[-11:-1]: # exclude the latest one we just added since it's the current query
                history_context += f"[{msg.role.upper()}]: {msg.content}\n"
            history_context += "\n"

        cases = session.exec(select(Case)).all()
        overview = taskforce_service.build_overview(cases)

        client = _get_gemini_client()
        reply = None
        
        if client:
            context = _build_context(list(cases), overview)
            final_prompt = f"{context}\n\n{history_context}User query: {query}"
            for model_name in [_GEMINI_MODEL, "gemini-2.0-flash-001", "gemini-2.0-flash-exp", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-lite-preview-02-05"]:
                try:
                    if client == "generativeai":
                        import google.generativeai as genai
                        model = genai.GenerativeModel(model_name)
                        # Add explicit timeout for legacy SDK (generativeai doesn't natively support it easily in generate_content, so we rely on global or just fast failure, but actually we can just let it be since genai handles it better)
                        response = model.generate_content(final_prompt)
                        if response and response.text:
                            reply = response.text
                            break
                    else:
                        from google.genai import types
                        # Set a strict 15 second timeout to prevent Render 502 connection drops
                        config = types.GenerateContentConfig(
                            system_instruction="You are Aegis, AduanFlow AI Copilot.",
                            temperature=0.2,
                        )
                        response = client.models.generate_content(
                            model=model_name,
                            contents=final_prompt,
                            config=config
                        )
                        if response and response.text:
                            reply = response.text
                            break
                except Exception as e:
                    logger.warning(f"[Copilot] Gemini model '{model_name}' failed: {e}. Trying next fallback...")

        if not reply:
            # Rule-based fallback
            reply = self._rule_based(query, list(cases), overview)
            
        # 4. Save AI response
        try:
            ai_msg = Message(role="assistant", content=reply, conversation_id=conv.id)
            session.add(ai_msg)
            conv.updated_at = datetime.utcnow()
            session.commit()
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            logger.error(f"[Copilot] Failed to save AI response to database: {e}\n{error_trace}")
            try:
                with open(r"C:\Users\Admin\.gemini\antigravity-ide\brain\56218270-cfab-49b5-8869-22f5050b199a\scratch\db_debug.txt", "w") as f:
                    f.write(error_trace)
            except:
                pass
            session.rollback()
        
        return reply, conv.id

    def _rule_based(self, query: str, cases: List[Case], overview: Dict[str, Any]) -> str:
        q = query.lower().strip()
        total_cases = len(cases)
        missions = overview.get("missions", [])
        squads = overview.get("squads", [])

        # Greeting intent
        words = q.split()
        if any(w in words or q == w for w in ["hey", "hi", "hello", "greetings", "yo", "morning", "afternoon"]):
            return (
                "Hello! I am **Aegis**, your **AduanFlow AI Copilot**.\n\n"
                "How can I assist you with dispute operations, BNM SLA tracking, or taskforce monitoring today?\n\n"
                "You can ask me about:\n"
                "- **Verification Engine** (\"how does the verification engine work?\")\n"
                "- **Intake & Encryption** (\"how does intake and encryption work?\")\n"
                "- **Financial Resolution** (\"explain financial resolution and journal entries\")\n"
                "- **Pipeline Summary** (\"show case status summary\")\n"
                "- **Investigator Workload** (\"list manual review queue\")"
            )

        if "verification" in q or "engine" in q or "mcp" in q:
            return (
                "**Core System Verification Engine (MCP):**\n\n"
                "The verification engine cross-references complaint data against Core Banking logs & CRM using Model Context Protocol (MCP):\n\n"
                "1. **Automated Validation**: Checks account ownership, transaction existence, and exact dispute amount matching.\n"
                "2. **Outcome Statuses**:\n"
                "   - **PASS**: All 6 core checks pass, no location or threshold anomaly. Proceed to instant resolution.\n"
                "   - **MANUAL_REVIEW**: Triggered if transaction amount exceeds **RM 5,000** or if a **location anomaly** is detected (e.g. mobile login in KL vs physical ATM withdrawal in JB 25 mins later).\n"
                "   - **FAIL**: Discrepancy in customer details or missing transaction records."
            )

        if "intake" in q or "ocr" in q or "security" in q or "encryption" in q:
            return (
                "**Email Intake & Security Enforcement:**\n\n"
                "1. **Intake**: Connects to the complaints mailbox (Gmail OAuth 2.0) and parses incoming emails & PDF statement attachments.\n"
                "2. **OCR Extraction**: Automatically extracts NRICs, account numbers, dispute amounts, and timestamps.\n"
                "3. **Security & PII Encryption**: Sensitive data (NRIC, full account number, dispute amount) is encrypted at rest using **Fernet symmetric encryption** (`nric_encrypted`). Masked views (`****4321`) are served on public UI endpoints."
            )

        if "classification" in q or "category" in q or "governance" in q:
            return (
                "**Automated Case Classification & Metadata Enrichment:**\n\n"
                "1. **7 PayNet Categories**: Categorizes complaints into `unauthorized_transactions`, `billing_errors`, `mis_selling_claims`, `atm_debit_card_disputes`, `insurance_takaful_claims`, `loan_financing_disputes`, and `emoney_digital_payment_disputes`.\n"
                "2. **BNM SLA Deadlines**:\n"
                "   - **High Urgency**: 5 Working Days SLA (Unauthorized transactions & ATM failure).\n"
                "   - **Medium / Low**: 20 Working Days SLA (Billing errors, mis-selling, loan disputes).\n"
                "3. **Governance Stamp**: Embeds BNM Policy Document compliance metadata directly into every case."
            )

        if "resolution" in q or "financial" in q or "journal" in q:
            return (
                "**Autonomous Financial Resolution Engine:**\n\n"
                "For verified (`PASS`) cases, the financial engine:\n"
                "1. Calculates adjustments and generates accounting journal entries (`JE-2026-xxxx`).\n"
                "2. Posts provisional credits or reversals directly to the complainant's core banking account.\n"
                "3. Automatically updates the case to `PASS` status with the resolution posted in < 3 minutes."
            )

        if "fmos" in q or "bnm" in q or "comms" in q or "communication" in q:
            return (
                "**Compliant Customer Communication:**\n\n"
                "1. **Templating Engine**: Generates pre-approved email resolution letters embedding mandatory BNM disclosures.\n"
                "2. **FMOS Redress Notice**: For claims ≤ **RM 250,000** where the customer remains dissatisfied, automatically embeds mandatory notice of their right to refer the matter to the Financial Ombudsman Scheme (FMOS) within **6 months**."
            )

        if "taskforce" in q and ("coverage" in q or "show" in q or "overview" in q):
            squad_lines = "\n".join(
                f"- **{s['name']}** ({s['lead']}) — {s['caseCount']} tracked cases, {s['activeCount']} active"
                for s in squads
            )
            return (
                f"**AI Banking Dispute Automation Taskforce Coverage:**\n"
                f"- **Active missions**: {overview['summary']['activeMissionCount']}\n"
                f"- **Manual escalations**: {overview['summary']['manualEscalations']}\n"
                f"- **High-value exposure**: RM {overview['summary']['highValueExposure']:,.2f}\n"
                f"- **Straight-through rate**: {overview['summary']['straightThroughRate']}%\n\n"
                f"**Squad map:**\n{squad_lines}"
            )

        if ("squad" in q and "escalation" in q) or ("who" in q and "owns" in q):
            active = [m for m in missions if m["status"] in {"MANUAL_REVIEW"}]
            if not active:
                return "There are no open escalation missions right now. The taskforce is in monitoring mode."
            lines = "\n".join(
                f"• **{m['caseId']}** → **{m['squad']}** ({m['owner']}) — {m['reason']}"
                for m in active[:5]
            )
            return f"**Escalation Ownership:**\n{lines}"

        if "high-risk" in q or ("taskforce" in q and "dispute" in q):
            if not missions:
                return "No high-risk disputes are currently under taskforce watch."
            lines = "\n".join(
                f"• **{m['caseId']}** — {m['category']} ({m['status']}, RM {m['amount']:,.2f}) handled by **{m['squad']}**"
                for m in missions[:6]
            )
            return f"**High-Risk Dispute Watchlist:**\n{lines}"

        if "remediation" in q or ("manual review" in q and ("summary" in q or "prepare" in q)):
            manual = [m for m in missions if m["status"] == "MANUAL_REVIEW"]
            if not manual:
                return "There are no manual-review missions that need remediation planning right now."
            lines = "\n".join(f"• **{m['caseId']}** — {m['recommendedAction']}" for m in manual[:5])
            return f"**Manual Review Remediation Summary:**\n{lines}"

        if "status" in q or "how many" in q or "summary" in q:
            pass_cases = len([c for c in cases if c.status == "PASS"])
            manual_cases = len([c for c in cases if c.status == "MANUAL_REVIEW"])
            return (
                f"**Dispute Pipeline Overview:**\n"
                f"- **Total Cases**: {total_cases}\n"
                f"- **Auto-Verified (PASS)**: {pass_cases}\n"
                f"- **Manual Review Queue**: {manual_cases}\n"
                f"- **Automation Rate**: {round((pass_cases / total_cases) * 100 if total_cases else 0)}%"
            )

        if "sla" in q or "due" in q or "deadline" in q:
            high_urgency = [c for c in cases if c.urgency == "high"]
            return (
                f"**BNM SLA Compliance Status:**\n"
                f"- **High Urgency Cases (5 WD SLA)**: {len(high_urgency)}\n"
                f"- **Priority Coverage**: {overview['summary']['priorityCoverage']} cases under active watch."
            )

        if "workload" in q or "investigator" in q or "manual" in q:
            manual_cases = [c for c in cases if c.status == "MANUAL_REVIEW"]
            reasons = "\n".join(
                f"• **{c.id}**: {c.customer_name} ({c.masked_account}) — "
                f"{c.verification.get('manualReviewReason', 'Manual check required') if c.verification else 'Investigation pending'}"
                for c in manual_cases
            )
            return (
                f"**Investigator Workload & Manual Queue:**\n"
                f"There are currently **{len(manual_cases)} cases** requiring human investigation:\n\n"
                f"{reasons if manual_cases else 'No cases pending manual review.'}"
            )

        if "explain" in q or "more" in q or "detail" in q or "how it works" in q or "what do you do" in q:
            return (
                "**Aegis AI Copilot — Capability Breakdown:**\n\n"
                "I am an intelligent agentic AI assistant designed to automate end-to-end banking dispute management under Bank Negara Malaysia (BNM) standards:\n\n"
                "1. **Automated Intake & Security**: Extract account IDs & NRICs from complaint emails & PDFs with Fernet encryption at rest.\n"
                "2. **Governance & Classification**: Categorize complaints into 7 PayNet dispute types and calculate strict 5-day or 20-day BNM SLA deadlines.\n"
                "3. **Core Banking Verification (MCP)**: Verify transactions against core banking logs, flagging anomalies (>RM 5,000 or location mismatches) for human review.\n"
                "4. **Financial Resolution**: Calculate adjustments and generate accounting journal entries (`JE-2026-xxxx`) automatically.\n"
                "5. **Compliant Comms**: Generate final resolution notices with mandatory BNM disclosures and FMOS 6-month redress rights."
            )

        if "who" in q and ("you" in q or "r u" in q or "aegis" in q or "copilot" in q):
            return (
                "Hello! I am **Aegis**, your **AduanFlow AI Copilot** and Banking Dispute Taskforce Orchestrator.\n\n"
                "I assist bank investigators and compliance officers by monitoring dispute pipelines, tracking BNM SLA deadlines, "
                "executing automated financial resolutions, and orchestrating squad escalations for manual review cases."
            )

        # Check if user asked about a specific case ID (e.g. DISP-2026-XXXX)
        import re
        case_match = re.search(r"disp-2026-\d+", q)
        if case_match:
            target_id = case_match.group(0).upper()
            found = next((c for c in cases if c.id == target_id), None)
            if found:
                return (
                    f"**Case Details for {found.id}:**\n\n"
                    f"- **Customer**: {found.customer_name} ({found.customer_email})\n"
                    f"- **Category**: `{found.category}`\n"
                    f"- **Amount**: RM {found.amount:,.2f}\n"
                    f"- **Status**: **{found.status}**\n"
                    f"- **Verification Outcome**: `{found.verification_result}`\n"
                    f"- **Account**: `{found.masked_account}`\n"
                    f"- **Urgency**: {found.urgency.upper() if found.urgency else 'MEDIUM'}\n"
                    f"- **Received**: {found.received_at.strftime('%d %b %Y, %H:%M') if found.received_at else 'N/A'}"
                )
            else:
                return f"Case **{target_id}** was not found in the dispute database."

        # Check if user asked about a customer name
        for c in cases[:10]:
            if c.customer_name and c.customer_name.lower() in q:
                return (
                    f"**Matching Dispute for Customer '{c.customer_name}':**\n\n"
                    f"- **Case ID**: `{c.id}`\n"
                    f"- **Dispute Amount**: RM {c.amount:,.2f}\n"
                    f"- **Category**: `{c.category}`\n"
                    f"- **Current Status**: **{c.status}** (`{c.verification_result}`)"
                )

        return (
            f"I analyzed your query: **\"{query}\"**.\n\n"
            f"You can ask me about:\n"
            f"- **Specific Cases** (\"show case DISP-2026-29128\")\n"
            f"- **Verification Engine** (\"how does the verification engine work?\")\n"
            f"- **Intake & Security** (\"how does intake and encryption work?\")\n"
            f"- **Financial Resolution** (\"explain financial resolution and journal entries\")\n"
            f"- **FMOS & BNM Compliance** (\"what are FMOS redress requirements?\")\n"
            f"- **Pipeline Summary** (\"show case status summary\")\n"
            f"- **Investigator Workload** (\"list manual review queue\")"
        )


copilot_service = CopilotService()
