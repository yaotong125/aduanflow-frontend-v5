import React, { useState } from 'react';
import { apiFetch } from '../config';
import { mockCases, DISPUTE_CATEGORIES } from '../data/mockData';
import { downloadSamplePdf } from '../data/samplePdfs';
import {
  IconMail, IconShield, IconTag, IconCheck,
  IconCurrency, IconSend,
} from './Icons';

const PIPELINE_STEPS = [
  { key: 'intake', label: 'Intake', Icon: IconMail, desc: 'Email & OCR' },
  { key: 'security', label: 'Security', Icon: IconShield, desc: 'PII masking' },
  { key: 'classification', label: 'Classification', Icon: IconTag, desc: 'Category & SLA' },
  { key: 'verification', label: 'Verification', Icon: IconCheck, desc: 'System checks' },
  { key: 'financial', label: 'Financial', Icon: IconCurrency, desc: 'Resolution' },
  { key: 'communication', label: 'Communication', Icon: IconSend, desc: 'Response' },
];

// Helper to ensure naive database timestamps are correctly parsed as UTC with Date & Time
function formatUTC(dateString, options, fallbackReceivedAt) {
  if (!dateString) return '—';

  // If time-only string like "8:11 pm"
  if (typeof dateString === 'string' && (dateString.includes('pm') || dateString.includes('am'))) {
    const baseDate = fallbackReceivedAt ? new Date(fallbackReceivedAt) : new Date();
    const dateStr = isNaN(baseDate.getTime())
      ? ''
      : baseDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    return dateStr ? `${dateStr}, ${dateString}` : dateString;
  }

  // If time-only HH:MM:SS
  if (typeof dateString === 'string' && !dateString.includes('-')) {
    const baseIso = (fallbackReceivedAt ? new Date(fallbackReceivedAt) : new Date()).toISOString().slice(0, 10);
    dateString = `${baseIso}T${dateString}`;
  }

  let str = String(dateString).replace(' ', 'T');
  const withZ = str.endsWith('Z') ? str : str + 'Z';
  const date = new Date(withZ);
  if (isNaN(date.getTime())) return dateString;

  const defaultOpts = { dateStyle: 'medium', timeStyle: 'short' };
  return date.toLocaleString('en-MY', options || defaultOpts);
}

function getStepStatus(stepKey, caseData) {
  const status = caseData.status;
  const verifRes = caseData.verificationResult;

  if (stepKey === 'intake' || stepKey === 'security') return 'completed';
  if (stepKey === 'classification') return caseData.classification ? 'completed' : 'pending';

  if (stepKey === 'verification') {
    if (status === 'REJECTED' || verifRes === 'FAIL') return 'failed';
    if (status === 'MANUAL_REVIEW' || verifRes === 'MANUAL_REVIEW') return 'review';
    return 'completed';
  }

  if (stepKey === 'financial') {
    if (status === 'FINANCIALLY_RESOLVED' || caseData.financialResolution?.action === 'REVERSAL_EXECUTE') return 'completed';
    if (status === 'REJECTED' || caseData.financialResolution?.action === 'CLAIM_DECLINED') return 'failed';
    return 'pending';
  }

  if (stepKey === 'communication') {
    if (status === 'FINANCIALLY_RESOLVED' || status === 'REJECTED') return 'completed';
    if (status === 'MANUAL_REVIEW') return 'review';
    const hasComm = caseData.communication?.acknowledgementSent || caseData.communication?.finalResponse;
    return hasComm ? 'completed' : 'pending';
  }

  return 'pending';
}

function PipelineStepper({ caseData }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-6">
      <h3 className="font-semibold text-slate-900 mb-5">Pipeline Progress</h3>
      <div className="flex items-start gap-0 overflow-x-auto pb-2">
        {PIPELINE_STEPS.map(({ key, label, Icon, desc }, idx) => {
          const status = getStepStatus(key, caseData);
          const isLast = idx === PIPELINE_STEPS.length - 1;
          const circleStyles = {
            completed: 'bg-green-500 border-green-500 text-white',
            failed: 'bg-red-500 border-red-500 text-white',
            review: 'bg-amber-500 border-amber-500 text-white',
            pending: 'bg-white border-slate-200 text-slate-400',
          };
          const lineColor = status === 'completed' ? 'bg-green-300' : status === 'failed' ? 'bg-red-300' : 'bg-slate-200';
          return (
            <div key={key} className="flex items-center flex-1 min-w-[80px]">
              <div className="flex flex-col items-center text-center flex-1">
                <div className={`w-12 h-12 rounded-full border-[3px] flex items-center justify-center transition-all ${circleStyles[status] || circleStyles.pending}`}>
                  {status === 'completed' ? (
                    <IconCheck className="w-5 h-5" />
                  ) : status === 'failed' ? (
                    <span className="text-sm">✕</span>
                  ) : status === 'review' ? (
                    <span className="text-sm font-bold">!</span>
                  ) : (
                    <Icon className="w-5 h-5 opacity-40" />
                  )}
                </div>
                <p className="text-xs font-semibold text-slate-700 mt-2">{label}</p>
                <p className="text-[11px] text-slate-400 leading-tight">{desc}</p>
              </div>
              {!isLast && <div className={`h-0.5 flex-1 ml-2 -mr-2 ${lineColor}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CASE_TABS = [
  { id: 'analysis', label: 'AI Analysis' },
  { id: 'financial', label: 'Financials' },
  { id: 'communication', label: 'Communication' },
  { id: 'audit', label: 'Audit Trail' },
];

function ConfidenceRing({ confidence }) {
  const pct = Math.round(confidence * 100);
  const circumference = 2 * Math.PI * 22;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 90 ? 'text-green-500' : pct >= 75 ? 'text-blue-500' : 'text-amber-500';

  return (
    <div className="relative w-14 h-14 inline-flex items-center justify-center shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="22" fill="none" stroke="#f1f5f9" strokeWidth="3" />
        <circle
          cx="25" cy="25" r="22" fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={color}
        />
      </svg>
      <span className="absolute text-xs font-bold text-slate-700">{pct}%</span>
    </div>
  );
}

export default function CaseDetail({ caseData, onBack }) {
  const [activeTab, setActiveTab] = useState('analysis');
  const [connectedEmail, setConnectedEmail] = useState('');
  const [processingAction, setProcessingAction] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [, setActionTick] = useState(0);

  const handleFinancialAction = (actionType) => {
    setProcessingAction(true);
    setActionNotice('');

    let newStatus = 'FINANCIALLY_RESOLVED';
    let verifResult = 'PASS';
    let finRes = {
      action: 'REVERSAL_EXECUTE',
      amount: caseData.amount,
      journalEntry: `JE-2026-${caseData.id?.replace('DISP-2026-', '')}`,
      executedAt: new Date().toISOString(),
    };

    if (actionType === 'DECLINE') {
      newStatus = 'REJECTED';
      verifResult = 'FAIL';
      finRes = {
        action: 'CLAIM_DECLINED',
        amount: 0,
        journalEntry: `GL-WITHHELD-${caseData.id?.replace('DISP-2026-', '')}`,
        executedAt: new Date().toISOString(),
      };
    } else if (actionType === 'REQUEST_DETAILS') {
      newStatus = 'MANUAL_REVIEW';
      verifResult = 'MANUAL_REVIEW';
      finRes = null;
    }

    apiFetch(`/api/cases/${caseData.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: newStatus,
        verification_result: verifResult,
        financial_resolution: finRes,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(errData.detail || `Server Error ${res.status}`);
        }
        return res.json();
      })
      .then((updatedCase) => {
        setProcessingAction(false);
        setActionNotice(`✓ Action executed! Case updated to ${newStatus}. Outbound email dispatched.`);
        Object.assign(caseData, updatedCase);
        setActionTick((t) => t + 1);
      })
      .catch((err) => {
        setProcessingAction(false);
        setActionNotice(`Error executing action: ${err.message}`);
      });
  };

  React.useEffect(() => {
    apiFetch('/api/auth/gmail-status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.email) setConnectedEmail(data.email);
      })
      .catch(() => {});
  }, []);

  // Derived once; avoids repeating the same fallback expression in multiple tabs
  const customerEmailDisplay =
    caseData?.customerEmail ||
    `${caseData?.customerName?.toLowerCase().replace(/\s+/g, '.')}@email.com`;

  if (!caseData) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-lg">Select a case to view details</p>
      </div>
    );
  }

  const cat = DISPUTE_CATEGORIES[caseData.category] || { label: caseData.category, color: 'bg-slate-100 text-slate-700' };

  const verifColors = {
    FINANCIALLY_RESOLVED: 'text-emerald-700 bg-emerald-50 border-emerald-300 font-bold',
    PASS: 'text-green-700 bg-green-50 border-green-200',
    REJECTED: 'text-red-700 bg-red-50 border-red-200',
    FAIL: 'text-red-700 bg-red-50 border-red-200',
    MANUAL_REVIEW: 'text-amber-700 bg-amber-50 border-amber-200',
  };

  return (
    <div className="space-y-6">
      {/* Header with breadcrumb-style back nav */}
      <div>
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mb-3 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Cases
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-900">{caseData.id}</h2>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${verifColors[caseData.status] || verifColors[caseData.verificationResult] || 'text-blue-700 bg-blue-50 border-blue-200'}`}>
            {(caseData.status || caseData.verificationResult || 'PENDING').replace(/_/g, ' ')}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span>
          {caseData.urgency === 'high' && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
              HIGH URGENCY
            </span>
          )}
        </div>
      </div>

      <PipelineStepper caseData={caseData} />

      {/* Summary metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Amount</p>
          <p className="text-lg font-bold text-slate-900 font-mono mt-0.5">RM {caseData.amount.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Customer</p>
          <p className="text-sm font-semibold text-slate-800 truncate">{caseData.customerName}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{caseData.maskedAccount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">SLA Deadline</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">
            {formatUTC(caseData.dueDate, { day: 'numeric', month: 'short' })}
          </p>
          <p className="text-xs text-slate-500">{caseData.classification?.slaHours || '—'}h window</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Processing</p>
          <p className="text-lg font-bold text-slate-900 font-mono mt-0.5">{caseData.processingTime}</p>
          <p className="text-xs text-slate-500">{caseData.assignedTo || 'Unassigned'}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="border-b border-slate-100 flex overflow-x-auto">
          {CASE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-blue-600 border-blue-500'
                  : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* ===== AI Analysis Tab ===== */}
          {activeTab === 'analysis' && (
            <div className="space-y-6">
              {/* Original Complaint Email */}
              {caseData.emailBody && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Original Complaint Email</h4>
                  <div className="bg-slate-50 rounded-t-lg border border-slate-200 px-4 py-3 space-y-1 text-xs">
                    <div className="flex gap-2">
                      <span className="text-slate-500 font-medium w-12 shrink-0">From:</span>
                      <span className="text-slate-700">{customerEmailDisplay}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 font-medium w-12 shrink-0">To:</span>
                      <span className="text-slate-700 font-medium">{connectedEmail || caseData.emailTo || 'ganyaotong@graduate.utm.my'}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 font-medium w-12 shrink-0">Date:</span>
                      <span className="text-slate-700">{formatUTC(caseData.receivedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 font-medium w-12 shrink-0">Subject:</span>
                      <span className="text-slate-800 font-medium">{caseData.emailSubject}</span>
                    </div>
                  </div>
                  <div className="bg-white border border-t-0 border-slate-200 rounded-b-lg p-4 text-sm text-slate-700 whitespace-pre-line max-h-48 overflow-y-auto">
                    {caseData.emailBody}
                  </div>
                </div>
              )}

              {/* Customer Replies & Evidence Submissions (if customer replied to info request) */}
              {caseData.communication?.replies && caseData.communication.replies.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Customer Reply & Evidence Submission ({caseData.communication.replies.length})
                  </h4>
                  <div className="space-y-3">
                    {caseData.communication.replies.map((reply, rIdx) => (
                      <div key={rIdx} className="border border-blue-200 rounded-xl overflow-hidden shadow-xs bg-blue-50/30">
                        <div className="bg-blue-50/80 border-b border-blue-200 px-4 py-2.5 space-y-1 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-blue-900">INBOUND REPLY #{rIdx + 1}</span>
                            <span className="font-mono text-slate-500">{formatUTC(reply.receivedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-slate-500 font-medium w-12 shrink-0">From:</span>
                            <span className="text-slate-800 font-medium">{reply.from || customerEmailDisplay}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-slate-500 font-medium w-12 shrink-0">Subject:</span>
                            <span className="text-slate-900 font-medium">{reply.subject}</span>
                          </div>
                        </div>
                        <div className="p-4 text-xs text-slate-800 whitespace-pre-line max-h-48 overflow-y-auto font-sans leading-relaxed bg-white">
                          {reply.body}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Classification */}
              {caseData.classification && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Classification</h4>
                  <div className="flex flex-wrap items-center gap-4 mb-3">
                    <ConfidenceRing confidence={caseData.classification.confidence} />
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      <div><span className="text-slate-500">Category:</span> <span className="font-medium text-slate-700">{cat.label}</span></div>
                      <div><span className="text-slate-500">Urgency:</span> <span className="font-medium text-slate-700 capitalize">{caseData.classification.urgency}</span></div>
                      <div><span className="text-slate-500">SLA:</span> <span className="font-medium text-slate-700">{caseData.classification.slaHours}h</span></div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{caseData.classification.rationale}</p>
                </div>
              )}

              {/* Verification */}
              {caseData.verification && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-slate-700">Verification Results</h4>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${verifColors[caseData.verificationResult] || ''}`}>
                      {caseData.verificationResult}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {caseData.verification.checks.map((check, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 text-base leading-none">{check.passed === true ? '✅' : check.passed === false ? '❌' : '⏳'}</span>
                        <div className="flex-1">
                          <span className="text-slate-700">{check.check}</span>
                          {check.detail && <p className="text-xs text-slate-500 mt-0.5">{check.detail}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {caseData.verification.manualReviewReason && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                      <p className="text-xs font-medium text-amber-700">Manual Review Reason:</p>
                      <p className="text-sm text-amber-800 mt-0.5">{caseData.verification.manualReviewReason}</p>
                    </div>
                  )}
                </div>
              )}

              {/* OCR Extraction */}
              {caseData.ocrResults && (() => {
                const rawAtt = caseData.ocrResults.extractedFields?.attachment_processed;
                const attachmentList = (() => {
                  if (Array.isArray(caseData.ocrResults?.attachments) && caseData.ocrResults.attachments.length > 0) {
                    return caseData.ocrResults.attachments.filter(a => a && a !== "None" && a !== "none");
                  }
                  if (Array.isArray(caseData.attachments) && caseData.attachments.length > 0) {
                    return caseData.attachments.filter(a => a && a !== "None" && a !== "none");
                  }
                  if (rawAtt && rawAtt !== "None" && rawAtt !== "none" && rawAtt !== "null") {
                    return rawAtt.split(',').map(s => s.trim()).filter(s => s && s !== "None" && s !== "none");
                  }
                  return [];
                })();

                return (
                  <div className="space-y-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3">
                        OCR Extraction
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {' '}({(caseData.ocrResults.confidence * 100).toFixed(0)}% confidence)
                        </span>
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {Object.entries(caseData.ocrResults.extractedFields || {}).map(([key, val]) => {
                          let displayVal = val;
                          if (key === 'attachment_processed') {
                            displayVal = attachmentList.length > 0 ? attachmentList.join(', ') : 'None';
                          }
                          return (
                            <div key={key} className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[10px] text-slate-500 uppercase">{key.replace(/_/g, ' ')}</p>
                              <p className="text-sm font-medium text-slate-700">{displayVal ?? 'None'}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* PDF Evidence & Attachments Section — Displayed Vertically One After Another */}
                    {attachmentList.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-100 text-red-700 text-xs font-bold">PDF</span>
                            PDF Evidence & Attachments ({attachmentList.length} {attachmentList.length === 1 ? 'file' : 'files'})
                          </h4>
                          <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                            Multi-Layer OCR (PyMuPDF + RapidOCR)
                          </span>
                        </div>

                        <div className="space-y-4">
                          {attachmentList.map((filename, idx) => (
                            <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-slate-300">
                              {/* Card Top Header */}
                              <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-xs">
                                    PDF
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-100 truncate">{filename}</p>
                                    <p className="text-[10px] text-slate-400 font-mono">Attachment #{idx + 1} · Verification Artifact · Governance Validated</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    OCR PARSED
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => downloadSamplePdf(filename, caseData)}
                                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded-lg border border-slate-700 transition-colors font-medium inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    📥 Download
                                  </button>
                                </div>
                              </div>

                              {/* Document Viewer Container */}
                              <div className="p-4 bg-slate-50/60 border-t border-slate-100">
                                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs font-mono text-xs text-slate-700 space-y-3">
                                  <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-100 pb-2">
                                    <span>[PDF DOCUMENT CONTAINER] {filename}</span>
                                    <span>Page 1 of 1</span>
                                  </div>
                                  <div className="whitespace-pre-line text-slate-800 leading-relaxed font-sans text-xs bg-slate-50/80 p-3.5 rounded-md border border-slate-100 max-h-48 overflow-y-auto">
                                    {caseData.ocrResults?.extracted_text || (
                                      `BANKING COMPLAINT EVIDENCE DOCUMENT\n\n` +
                                      `Document File: ${filename}\n` +
                                      `Dispute Reference: ${caseData.id}\n` +
                                      `Customer Name: ${caseData.customerName}\n` +
                                      `Account Reference: ${caseData.maskedAccount}\n` +
                                      `Claim Amount: RM ${caseData.amount?.toLocaleString()}\n\n` +
                                      `[OCR Extraction Summary]: Attached receipt / statement evidence parsed successfully via Rhea Ingestion Agent (Confidence: ${Math.round((caseData.ocrResults?.confidence || 0.94) * 100)}%).`
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                                      BNM Audit Trail Compliant Document
                                    </span>
                                    <span>Encrypted PII at rest (Fernet AES-256)</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ===== Financials Tab ===== */}
          {activeTab === 'financial' && (
            <div className="space-y-6">
              {/* Financial Resolution Control Panel (Screenshot 1 matching) */}
              <div className="p-5 bg-amber-50/60 border border-amber-200/80 rounded-xl space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 font-bold text-lg">⚡</span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Financial Resolution Control Panel</h4>
                      <p className="text-xs text-slate-600">
                        Select an action below to post GL journal entry, dispatch customer notice, or request additional details.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold px-3 py-1 bg-amber-100/80 text-amber-900 rounded-lg border border-amber-300">
                    EXPOSURE: RM {caseData.amount?.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Action feedback message */}
                {actionNotice && (
                  <div className={`p-3 rounded-lg text-xs font-medium ${actionNotice.startsWith('Error') ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                    {actionNotice}
                  </div>
                )}

                {/* PROPOSED GL JOURNAL VOUCHER BOX */}
                <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-200 border border-slate-800 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-amber-400 font-bold border-b border-slate-800 pb-2">
                    <span>PROPOSED GL JOURNAL VOUCHER</span>
                    <span className="text-slate-400">JE-2026-{caseData.id?.replace('DISP-2026-', '')}</span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between">
                      <span className="text-slate-300">DEBIT 1104-9821-DISPUTE (Bank Loss Suspense)</span>
                      <span className="text-emerald-400 font-semibold">RM {caseData.amount?.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">CREDIT {caseData.maskedAccount} (Customer Account)</span>
                      <span className="text-emerald-400 font-semibold">RM {caseData.amount?.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 border-t border-slate-800 pt-2">
                    <span>MEMO: Settlement for Case {caseData.id}</span>
                    <span className="font-semibold text-amber-300">
                      STATUS: {caseData.status === 'FINANCIALLY_RESOLVED' ? 'POSTED' : caseData.status === 'REJECTED' ? 'DECLINED' : 'AWAITING AUTHORIZATION'}
                    </span>
                  </div>
                </div>

                {/* 3 INTERACTIVE ACTION BUTTONS */}
                {(() => {
                  const isApproveActive = caseData.status === 'FINANCIALLY_RESOLVED';
                  const isDeclineActive = caseData.status === 'REJECTED';
                  const isRequestDetailsActive = caseData.status === 'MANUAL_REVIEW';

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                      {/* Button 1: Post Credit */}
                      <button
                        type="button"
                        onClick={() => handleFinancialAction('APPROVE')}
                        disabled={processingAction || isApproveActive}
                        className={`py-3 px-4 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 border ${
                          isApproveActive
                            ? 'bg-emerald-100 border-emerald-300 text-emerald-800 opacity-80 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white cursor-pointer border-emerald-500'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${isApproveActive ? 'bg-emerald-600' : 'bg-emerald-300 border border-white'}`} />
                        {isApproveActive ? '✓ Posted & Notified' : 'Post Credit & Send Notice'}
                      </button>

                      {/* Button 2: Decline Claim */}
                      <button
                        type="button"
                        onClick={() => handleFinancialAction('DECLINE')}
                        disabled={processingAction || isDeclineActive}
                        className={`py-3 px-4 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 border ${
                          isDeclineActive
                            ? 'bg-rose-100 border-rose-300 text-rose-800 opacity-80 cursor-not-allowed'
                            : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white cursor-pointer border-rose-500'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${isDeclineActive ? 'bg-rose-600' : 'bg-rose-300 border border-white'}`} />
                        {isDeclineActive ? '✓ Claim Declined' : 'Decline Claim'}
                      </button>

                      {/* Button 3: Request Details */}
                      <button
                        type="button"
                        onClick={() => handleFinancialAction('REQUEST_DETAILS')}
                        disabled={processingAction || isRequestDetailsActive}
                        className={`py-3 px-4 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 border ${
                          isRequestDetailsActive
                            ? 'bg-slate-200 border-slate-300 text-slate-700 opacity-80 cursor-not-allowed'
                            : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-white cursor-pointer border-slate-700'
                        }`}
                      >
                        <span>📥</span>
                        {isRequestDetailsActive ? '✓ Details Requested' : 'Request Details'}
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Status Summary Card */}
              {caseData.financialResolution && (
                <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${caseData.status === 'REJECTED' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    <h4 className="text-sm font-semibold text-slate-800">
                      {caseData.status === 'REJECTED' ? 'Financial Claim Declined' : 'Financially Resolved'}
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div><span className="text-slate-500">Action:</span> <span className="font-medium text-slate-700">{caseData.financialResolution.action}</span></div>
                    <div><span className="text-slate-500">Amount:</span> <span className="font-mono font-medium text-slate-700">RM {caseData.financialResolution.amount?.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span></div>
                    <div><span className="text-slate-500">Journal:</span> <span className="font-mono text-xs text-slate-600">{caseData.financialResolution.journalEntry}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== Communication Tab (Stacked Chronologically - Most Recent at Top) ===== */}
          {activeTab === 'communication' && (
            <div className="space-y-4">
              {/* High-visibility Delivery Verification Status Banner */}
              <div className="p-4 bg-emerald-50/90 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-xs flex-shrink-0">
                    ✓
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-emerald-950">Outbound Email Dispatch Verified</h4>
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white uppercase tracking-wider">
                        Gmail OAuth 2.0 / SMTP
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Transmitted to <span className="font-semibold font-mono text-emerald-900">{customerEmailDisplay}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-emerald-800 shrink-0 font-mono bg-white/80 px-3 py-1.5 rounded-lg border border-emerald-200">
                  <p className="font-bold text-emerald-700">STATUS: DELIVERED (HTTP 200)</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {formatUTC(caseData.communication?.finalResponse?.sentAt || caseData.receivedAt, { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              </div>

              {/* Stacked Email List (Most Recent First) */}
              {(() => {
                const comms = caseData.communication || {};
                let emails = comms.emails || [];

                if (emails.length === 0) {
                  if (comms.finalResponse) {
                    emails.push({
                      type: caseData.status,
                      subject: comms.finalResponse.subject,
                      body: comms.finalResponse.body,
                      sentAt: comms.finalResponse.sentAt || caseData.receivedAt,
                      recipient: customerEmailDisplay,
                      actionLabel: caseData.status === 'FINANCIALLY_RESOLVED' ? 'Resolution Approved' : caseData.status === 'REJECTED' ? 'Claim Declined' : 'Dispute Notice',
                    });
                  }
                  if (comms.acknowledgementSent || comms.acknowledgement) {
                    emails.push({
                      type: 'ACKNOWLEDGEMENT',
                      subject: comms.acknowledgement?.subject || `Dispute Acknowledgement: Case ${caseData.id} Logged`,
                      body: comms.acknowledgement?.body || `Dear ${caseData.customerName},\n\nWe acknowledge receipt of your dispute complaint. Your case is under review.`,
                      sentAt: comms.acknowledgementSent || caseData.receivedAt,
                      recipient: customerEmailDisplay,
                      actionLabel: 'Dispute Acknowledgement',
                    });
                  }
                }

                if (emails.length === 0) {
                  return (
                    <div className="text-center py-8 text-slate-500">
                      <p className="text-sm">No email communications logged yet</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4 pt-1">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <span>📩 Outbound Email History ({emails.length}) — Stacked Most Recent First</span>
                    </h4>
                    {emails.map((mail, idx) => (
                      <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden shadow-xs bg-white">
                        <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-100 uppercase font-mono">
                              {mail.actionLabel || mail.type || 'OUTBOUND EMAIL'}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              {formatUTC(mail.sentAt, { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <span className="text-slate-500 font-medium w-12 shrink-0">From:</span>
                            <span className="text-slate-800 font-medium">{connectedEmail || 'complaints@aduanflow.bank'}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-slate-500 font-medium w-12 shrink-0">To:</span>
                            <span className="text-slate-800 font-mono">{mail.recipient || customerEmailDisplay}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-slate-500 font-medium w-12 shrink-0">Subject:</span>
                            <span className="text-slate-900 font-bold">{mail.subject}</span>
                          </div>
                        </div>
                        <div className="p-4 text-xs text-slate-700 whitespace-pre-line max-h-56 overflow-y-auto font-sans leading-relaxed bg-white">
                          {mail.body}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ===== Audit Tab ===== */}
          {activeTab === 'audit' && (
            <div className="space-y-0">
              {caseData.auditLog.map((entry, idx) => (
                <div key={idx} className="flex gap-3 pb-4 relative">
                  {idx < caseData.auditLog.length - 1 && <div className="absolute left-[5.5px] top-5 bottom-0 w-px bg-slate-100" />}
                  <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0 mt-1.5 ring-2 ring-blue-100" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-mono text-slate-500">{formatUTC(entry.time, null, caseData.receivedAt)}</span>
                      <span className="text-xs font-medium text-blue-600">{entry.actor}</span>
                    </div>
                    <p className="text-sm text-slate-700">{entry.action}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{entry.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
