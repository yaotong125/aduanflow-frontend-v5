from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
import uuid

class ConversationBase(SQLModel):
    title: Optional[str] = Field(default="New Conversation")

class Conversation(ConversationBase, table=True):
    __tablename__ = "copilot_conversations"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    messages: List["Message"] = Relationship(
        back_populates="conversation", 
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )

class ConversationRead(ConversationBase):
    id: str
    created_at: datetime
    updated_at: datetime

class MessageBase(SQLModel):
    role: str # "user" or "assistant"
    content: str
    conversation_id: str = Field(foreign_key="copilot_conversations.id")

class Message(MessageBase, table=True):
    __tablename__ = "copilot_messages"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    conversation: Conversation = Relationship(back_populates="messages")

class MessageRead(SQLModel):
    id: str
    role: str
    content: str
    created_at: datetime
    conversation_id: str

class ConversationWithMessages(ConversationRead):
    messages: List[MessageRead] = []
