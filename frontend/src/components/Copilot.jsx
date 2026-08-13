import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../config';
import { COPILOT_SUGGESTIONS, COPILOT_RESPONSES } from '../data/mockData';
import { TASKFORCE_TEAM } from '../data/taskforceData';

const TASKFORCE_SUGGESTIONS = TASKFORCE_TEAM.commandPrompts;

function GeminiSparkleIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4771 12 22C12 16.4771 16.4771 12 22 12C16.4771 12 12 7.52285 12 2Z"
        fill="url(#gemini-sparkle-grad)"
      />
      <defs>
        <linearGradient id="gemini-sparkle-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 max-w-[80%]">
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-100 via-indigo-50 to-purple-100 border border-indigo-200/60 flex items-center justify-center shrink-0 shadow-xs">
        <GeminiSparkleIcon className="w-4 h-4 animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5 px-4 py-3 bg-white border border-slate-200/80 rounded-2xl rounded-tl-sm shadow-xs">
        <span className="typing-dot animate-bounce-dot bg-blue-500" />
        <span className="typing-dot animate-bounce-dot bg-indigo-500" />
        <span className="typing-dot animate-bounce-dot bg-purple-500" />
      </div>
    </div>
  );
}

function renderInlineFormatted(text, onViewCase) {
  if (!text) return null;

  // Handle inline code `code`
  const codeParts = text.split(/`(.*?)`/g);
  return codeParts.map((cPart, cIdx) => {
    if (cIdx % 2 === 1) {
      return (
        <code key={`code-${cIdx}`} className="bg-slate-100 text-blue-700 border border-slate-200/80 px-1.5 py-0.5 rounded text-xs font-mono font-medium">
          {cPart}
        </code>
      );
    }

    // Handle Case ID links DISP-2026-XXXX
    const caseParts = cPart.split(/(DISP-2026-\d+)/g);
    return caseParts.map((caseStr, caseIdx) => {
      if (caseStr.match(/^DISP-2026-\d+$/)) {
        return (
          <button
            key={`case-${caseIdx}`}
            onClick={() => onViewCase && onViewCase(caseStr)}
            className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-600 hover:text-white transition-all cursor-pointer mx-0.5 shadow-2xs"
            title={`View details for ${caseStr}`}
          >
            {caseStr}
          </button>
        );
      }

      // Handle bold **text**
      const boldParts = caseStr.split(/\*\*(.*?)\*\*/g);
      return boldParts.map((bPart, bIdx) =>
        bIdx % 2 === 1 ? (
          <strong key={`bold-${bIdx}`} className="font-semibold text-slate-900">
            {bPart}
          </strong>
        ) : (
          bPart
        )
      );
    });
  });
}

function renderFormattedText(text, onViewCase) {
  if (!text) return null;

  // Split code blocks ```...``` vs regular text
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map((part, pIdx) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3).trim();
      const firstLineEnd = content.indexOf('\n');
      let lang = 'CODE';
      let codeBody = content;
      if (firstLineEnd !== -1 && !content.substring(0, firstLineEnd).includes(' ')) {
        lang = content.substring(0, firstLineEnd).toUpperCase();
        codeBody = content.substring(firstLineEnd + 1);
      }
      return (
        <div key={pIdx} className="my-3 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 font-mono text-xs shadow-md">
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-slate-400 font-sans text-[11px]">
            <span className="font-semibold text-blue-400 uppercase tracking-wider">{lang}</span>
            <span className="text-[10px] text-slate-500 font-mono">Gemini AI Output</span>
          </div>
          <pre className="p-4 text-emerald-400 overflow-x-auto whitespace-pre leading-relaxed font-mono">
            {codeBody}
          </pre>
        </div>
      );
    }

    const lines = part.split('\n');
    const elements = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect Markdown Table (line starts with '|' and contains at least one inner '|')
      if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().includes('|', 1)) {
          tableLines.push(lines[i].trim());
          i++;
        }

        if (tableLines.length >= 2) {
          const parseRow = (l) => l.split('|').slice(1, -1).map((cell) => cell.trim());
          const headerCells = parseRow(tableLines[0]);
          let startRowIdx = 1;
          if (tableLines[1] && tableLines[1].replace(/[:\-\s|]/g, '') === '') {
            startRowIdx = 2; // skip divider line |:---|:---|
          }
          const bodyRows = tableLines.slice(startRowIdx).map(parseRow);

          elements.push(
            <div key={`table-${pIdx}-${i}`} className="my-3 overflow-x-auto rounded-xl border border-slate-200 shadow-2xs bg-white">
              <table className="w-full text-xs text-left border-collapse min-w-[320px]">
                <thead className="bg-slate-100/90 border-b border-slate-200 text-slate-900 font-bold uppercase text-[11px] tracking-wider">
                  <tr>
                    {headerCells.map((h, hIdx) => (
                      <th key={hIdx} className="px-3.5 py-2.5 border-r border-slate-200/60 last:border-r-0">
                        {renderInlineFormatted(h, onViewCase)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {bodyRows.map((row, rIdx) => (
                    <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white hover:bg-blue-50/20'}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2 border-r border-slate-100 last:border-r-0 font-medium">
                          {renderInlineFormatted(cell, onViewCase)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // Normal Markdown elements
      if (!trimmed) {
        elements.push(<div key={`empty-${i}`} className="h-1" />);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={`h3-${i}`} className="text-sm font-bold text-slate-900 mt-3 mb-1 tracking-tight">{renderInlineFormatted(line.replace('### ', ''), onViewCase)}</h3>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={`h2-${i}`} className="text-base font-bold text-slate-900 mt-4 border-b border-slate-100 pb-1.5 tracking-tight">{renderInlineFormatted(line.replace('## ', ''), onViewCase)}</h2>);
      } else if (line.startsWith('# ')) {
        elements.push(<h1 key={`h1-${i}`} className="text-lg font-extrabold text-slate-950 mt-4 mb-1 tracking-tight">{renderInlineFormatted(line.replace('# ', ''), onViewCase)}</h1>);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(
          <div key={`bullet-${i}`} className="flex items-start gap-2 text-xs md:text-sm ml-1 my-1">
            <span className="text-blue-500 font-bold shrink-0 mt-0.5">✦</span>
            <div className="leading-relaxed text-slate-700">{renderInlineFormatted(line.substring(2), onViewCase)}</div>
          </div>
        );
      } else if (line.match(/^(\d+\.)\s(.*)/)) {
        const numberMatch = line.match(/^(\d+\.)\s(.*)/);
        elements.push(
          <div key={`num-${i}`} className="flex items-start gap-2 text-xs md:text-sm ml-1 my-1">
            <span className="text-blue-600 font-bold shrink-0 font-mono text-[11px] mt-0.5 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-100">{numberMatch[1]}</span>
            <div className="leading-relaxed text-slate-700">{renderInlineFormatted(numberMatch[2], onViewCase)}</div>
          </div>
        );
      } else {
        elements.push(
          <p key={`p-${i}`} className="text-xs md:text-sm leading-relaxed text-slate-700">
            {renderInlineFormatted(line, onViewCase)}
          </p>
        );
      }

      i++;
    }

    return (
      <div key={pIdx} className="space-y-1.5">
        {elements}
      </div>
    );
  });
}

function BotMessage({ text, onViewCase }) {
  return (
    <div className="flex gap-3 max-w-[92%] items-start">
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-100 via-indigo-50 to-purple-100 border border-indigo-200/60 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
        <GeminiSparkleIcon className="w-4 h-4" />
      </div>
      <div className="bg-white text-slate-800 border border-slate-200/90 rounded-2xl rounded-tl-sm p-4 space-y-2 shadow-xs flex-1">
        {renderFormattedText(text, onViewCase)}
      </div>
    </div>
  );
}

export default function Copilot({ onViewCase }) {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const defaultMessage = {
    role: 'assistant',
    text: "Hello! I'm the AduanFlow AI Copilot. The AI Banking Dispute Automation Taskforce is now integrated, so I can help with dispute pipeline monitoring, taskforce coverage, escalations, and remediation planning.",
  };
  
  const [messages, setMessages] = useState([defaultMessage]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = () => {
    apiFetch('/api/copilot/conversations')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
      })
      .catch(err => console.warn('Failed to load conversations:', err));
  };

  const loadConversation = (id) => {
    setActiveConversationId(id);
    setIsTyping(false); // Reset typing state when switching chats
    apiFetch(`/api/copilot/conversations/${id}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.messages) {
          if (data.messages.length === 0) {
            setMessages([defaultMessage]);
          } else {
            setMessages(data.messages.map(m => ({ role: m.role, text: m.content })));
          }
        }
      })
      .catch(err => console.warn('Failed to load conversation:', err));
  };

  const startNewConversation = () => {
    setActiveConversationId(null);
    setMessages([defaultMessage]);
  };

  const deleteConversation = (id, e) => {
    e.stopPropagation();
    apiFetch(`/api/copilot/conversations/${id}`, { method: 'DELETE' })
      .then(() => {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (activeConversationId === id) {
          startNewConversation();
        }
      })
      .catch(err => console.warn('Failed to delete conversation:', err));
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = (text) => {
    const query = text || input.trim();
    if (!query) return;

    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setInput('');
    setIsTyping(true);

    const payload = { query };
    if (activeConversationId) {
      payload.conversation_id = activeConversationId;
    }

    apiFetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error('API Error');
        return res.json();
      })
      .then((data) => {
        const replyText = data?.reply || "I processed your request.";
        setMessages((prev) => [...prev, { role: 'assistant', text: replyText }]);
        setIsTyping(false);
        if (data.conversation_id) {
          if (data.conversation_id !== activeConversationId) {
            setActiveConversationId(data.conversation_id);
          }
          fetchConversations(); // Always refresh list so new chats appear immediately
        }
      })
      .catch((err) => {
        console.warn('Copilot API fallback:', err);
        const response =
          COPILOT_RESPONSES[query] || {
            text:
              "I understand you're asking about: \"" +
              query +
              '".\n\nI can now help with:\n- Case statuses\n- SLA tracking\n- Investigator workload\n- Taskforce coverage\n- High-risk dispute escalation\n- Manual review remediation plans',
          };
        setMessages((prev) => [...prev, { role: 'assistant', text: response.text }]);
        setIsTyping(false);
        // On fallback, if we already have an active conversation, we can fetch list just in case.
        // The backend rule-based fallback should now prevent 500 errors anyway.
        fetchConversations(); 
      });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-[calc(100vh-9.5rem)] md:h-[calc(100vh-9rem)] max-w-7xl mx-auto min-h-0 overflow-hidden relative">
      {/* Sidebar for Conversations (Gemini Style sliding drawer) */}
      <div className={`transition-all duration-300 ease-in-out shrink-0 h-full bg-[#f0f4f9] dark:bg-[#131314] rounded-2xl flex flex-col overflow-hidden z-10 ${isSidebarOpen ? 'w-64 opacity-100 mr-4' : 'w-0 opacity-0 mr-0'}`}>
        <div className="p-4 border-b border-transparent flex items-center justify-between">
          <button 
            onClick={startNewConversation}
            className="flex-1 flex items-center gap-3 py-2.5 px-4 bg-white/60 hover:bg-slate-200/50 dark:bg-white/10 dark:hover:bg-white/20 rounded-full text-slate-700 dark:text-slate-200 transition-colors shadow-sm font-medium text-sm"
            title="New Chat"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New chat</span>
          </button>
        </div>
        
        <div className="px-3 pb-2 pt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 pl-4 tracking-wide uppercase">Recent</div>
        
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 custom-scrollbar">
          {conversations.map(conv => (
            <div 
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              className={`group flex items-center justify-between py-2.5 px-3 rounded-full cursor-pointer transition-colors text-sm ${
                activeConversationId === conv.id 
                  ? 'bg-blue-100/60 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100 font-medium' 
                  : 'hover:bg-slate-200/50 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <svg className="w-4 h-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="truncate pr-2">{conv.title || "Conversation"}</span>
              </div>
              <button 
                onClick={(e) => deleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity rounded-full hover:bg-slate-300/50 dark:hover:bg-slate-700/50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="text-sm text-slate-400 text-center p-6 italic">No recent chats</div>
          )}
        </div>
      </div>


      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="shrink-0 mb-3">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
              className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors ${!isSidebarOpen ? 'ml-0' : ''}`}
              title="Toggle Menu"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h2 className="text-xl font-bold text-slate-900">AI Copilot</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Online
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-500 mt-0.5">Natural language interface for dispute operations and taskforce orchestration</p>
        </div>

        {/* Taskforce Integration Banner */}
        <div className="shrink-0 mb-3 rounded-xl border border-blue-100 bg-blue-50/80 p-3 text-xs md:text-sm text-blue-900 shadow-xs">
          <p className="font-semibold text-blue-950">Taskforce integration active</p>
          <p className="mt-0.5 text-blue-800/90 text-xs">
            Ask about squad ownership, escalation strategy, manual review remediation, or high-risk dispute watchlists.
          </p>
        </div>

        {/* Main Chat Card */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden flex flex-col min-h-0">
          {/* Messages scroll area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 min-h-0">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm text-white bg-gradient-to-r from-blue-500 to-blue-600 shadow-sm">
                    <p>{msg.text}</p>
                  </div>
                ) : msg.role === 'assistant' ? (
                  <BotMessage text={msg.text} onViewCase={onViewCase} />
                ) : null}
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <TypingIndicator />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestion Pills Bar (Always Visible) */}
          {!isTyping && (
            <div className="shrink-0 px-4 md:px-5 py-2 border-t border-slate-100 bg-slate-50/60 overflow-x-auto flex gap-1.5">
              {COPILOT_SUGGESTIONS.slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all font-medium cursor-pointer shrink-0"
                >
                  {s}
                </button>
              ))}
              {TASKFORCE_SUGGESTIONS.slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all font-medium cursor-pointer shrink-0"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Footer / Input Bar */}
          <div className="shrink-0 border-t border-slate-100 p-3 md:p-4 bg-white">
            <div className="flex items-center gap-2 md:gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about cases, escalations, squads, or remediation..."
                className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isTyping}
                className="px-4 md:px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs"
              >
                Send
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 text-right">Press Enter to send</p>
          </div>
        </div>
      </div>
    </div>
  );
}
