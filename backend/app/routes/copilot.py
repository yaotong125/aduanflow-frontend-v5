from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select
from typing import List, Optional

from backend.app.database import get_session
from backend.app.services.copilot_service import copilot_service
from backend.app.models.copilot import Conversation, ConversationRead, ConversationWithMessages, ConversationBase

router = APIRouter(prefix="/copilot", tags=["copilot"])

class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str
    conversation_id: str

@router.post("/chat", response_model=ChatResponse)
def chat_copilot(req: ChatRequest, session: Session = Depends(get_session)):
    """AI Copilot natural language endpoint for dispute operations."""
    reply, conv_id = copilot_service.process_query(req.query, session, req.conversation_id)
    return ChatResponse(reply=reply, conversation_id=conv_id)

@router.get("/conversations", response_model=List[ConversationRead])
def list_conversations(session: Session = Depends(get_session)):
    """List all AI Copilot conversations."""
    conversations = session.exec(select(Conversation).order_by(Conversation.updated_at.desc())).all()
    return conversations

@router.post("/conversations", response_model=ConversationRead)
def create_conversation(data: ConversationBase, session: Session = Depends(get_session)):
    """Create a new AI Copilot conversation."""
    conv = Conversation(title=data.title)
    session.add(conv)
    session.commit()
    session.refresh(conv)
    return conv

@router.get("/conversations/{conversation_id}", response_model=ConversationWithMessages)
def get_conversation(conversation_id: str, session: Session = Depends(get_session)):
    """Get a conversation by ID, including its messages."""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Sort messages by created_at (ascending)
    conv.messages.sort(key=lambda m: m.created_at)
    return conv

@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, session: Session = Depends(get_session)):
    """Delete a conversation."""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session.delete(conv)
    session.commit()
    return {"status": "deleted"}
