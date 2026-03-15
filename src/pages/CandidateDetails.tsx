import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { AlertTriangle, CheckCircle, Clock, FileText, ArrowRight, ShieldAlert, Check, Mail, Send } from 'lucide-react';
import { routeActions, generateReport } from '../services/pipeline';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

export default function CandidateDetails() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [overrideNotes, setOverrideNotes] = useState<Record<string, string>>({});
  const [sentEmails, setSentEmails] = useState<Record<string | number, boolean>>({});
  const [error, setError] = useState<Error | null>(null);
  const [isRouting, setIsRouting] = useState(false);

  useEffect(() => {
    const fetchCandidate = async () => {
      if (!id) return;
      try {
        const docRef = doc(db, 'candidates', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCandidate({ id: docSnap.id, ...data });
          if (data.sentEmails) {
            setSentEmails(data.sentEmails);
          }
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, `candidates/${id}`);
        } catch (handledErr) {
          setError(handledErr as Error);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchCandidate();
  }, [id]);

  if (error) throw error;

  if (loading) return <div className="p-8 text-center text-slate-500">Loading candidate profile...</div>;
  if (!candidate) return <div className="p-8 text-center text-rose-500">Candidate not found.</div>;

  const flags = JSON.parse(candidate.flags || '[]');
  const extractedData = JSON.parse(candidate.extractedData || '{}');
  const routingLog = JSON.parse(candidate.routingLog || '[]');
  const auditTrail = JSON.parse(candidate.auditTrail || '[]');

  const pendingCriticals = flags.filter((f: any) => f.severity === 'CRITICAL' && !f.resolution);
  const pendingWarnings = flags.filter((f: any) => f.severity === 'WARNING' && !f.resolution);

  const handleFlagAction = async (flagId: string, action: 'APPROVED' | 'REJECTED' | 'OVERRIDDEN') => {
    const updatedFlags = flags.map((f: any) => {
      if (f.flag_id === flagId || f.field === flagId) {
        return { ...f, resolution: action, hr_note: overrideNotes[flagId] || '' };
      }
      return f;
    });

    const newAudit = [...auditTrail, {
      stage: 5,
      action: `HR_${action}`,
      flag_id: flagId,
      actor: user?.email,
      note: overrideNotes[flagId] || '',
      timestamp: new Date().toISOString()
    }];

    const docRef = doc(db, 'candidates', id!);
    try {
      await updateDoc(docRef, {
        flags: JSON.stringify(updatedFlags),
        auditTrail: JSON.stringify(newAudit),
        updatedAt: serverTimestamp()
      });
      setCandidate({ ...candidate, flags: JSON.stringify(updatedFlags), auditTrail: JSON.stringify(newAudit) });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `candidates/${id}`);
      } catch (handledErr) {
        setError(handledErr as Error);
      }
    }
  };

  const handleManualDecision = async (decision: 'APPROVED' | 'BLOCKED') => {
    setIsRouting(true);
    const docRef = doc(db, 'candidates', id!);
    try {
      // Re-run routing and reporting based on the manual decision
      const routingResult = await routeActions(extractedData, flags, decision, candidate.documentsMissing || []);
      const reportResult = await generateReport({
        extractedData,
        flags,
        routing: routingResult.routing,
        status: decision
      });

      await updateDoc(docRef, {
        status: decision,
        summary: reportResult.summary,
        routingLog: JSON.stringify(routingResult.routing),
        updatedAt: serverTimestamp()
      });
      setCandidate({ 
        ...candidate, 
        status: decision,
        summary: reportResult.summary,
        routingLog: JSON.stringify(routingResult.routing)
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `candidates/${id}`);
      } catch (handledErr) {
        setError(handledErr as Error);
      }
    } finally {
      setIsRouting(false);
    }
  };

  const handleSendEmail = async (index: string | number) => {
    const newSentEmails = { ...sentEmails, [index]: true };
    setSentEmails(newSentEmails);
    
    try {
      const docRef = doc(db, 'candidates', id!);
      await updateDoc(docRef, {
        sentEmails: newSentEmails,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `candidates/${id}`);
      } catch (handledErr) {
        setError(handledErr as Error);
      }
    }
  };

  const finalizeRouting = async () => {
    setIsRouting(true);
    // Re-run routing and reporting now that HR has resolved flags
    const newStatus = flags.some((f: any) => f.severity === 'CRITICAL' && f.resolution !== 'APPROVED' && f.resolution !== 'OVERRIDDEN') ? 'BLOCKED' : 'APPROVED';
    
    try {
      const routingResult = await routeActions(extractedData, flags, newStatus, candidate.documentsMissing || []);
      const reportResult = await generateReport({
        extractedData,
        flags,
        routing: routingResult.routing,
        status: newStatus
      });

      const docRef = doc(db, 'candidates', id!);
      await updateDoc(docRef, {
        status: newStatus,
        summary: reportResult.summary,
        routingLog: JSON.stringify(routingResult.routing),
        updatedAt: serverTimestamp()
      });
      setCandidate({ ...candidate, status: newStatus, summary: reportResult.summary, routingLog: JSON.stringify(routingResult.routing) });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `candidates/${id}`);
      } catch (handledErr) {
        setError(handledErr as Error);
      }
    } finally {
      setIsRouting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">{candidate.candidateName}</h2>
          <div className="flex items-center gap-3 mt-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
              candidate.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
              candidate.status === 'BLOCKED' ? 'bg-rose-100 text-rose-800' :
              'bg-amber-100 text-amber-800'
            }`}>
              {candidate.status === 'APPROVED' && <CheckCircle size={16} />}
              {candidate.status === 'BLOCKED' && <AlertTriangle size={16} />}
              {candidate.status === 'PENDING' && <Clock size={16} />}
              {candidate.status}
            </span>
            <div className="flex gap-2 ml-2">
              <button disabled={isRouting} onClick={() => handleManualDecision('APPROVED')} className="px-3 py-1 text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50">Approve</button>
              <button disabled={isRouting} onClick={() => handleManualDecision('BLOCKED')} className="px-3 py-1 text-sm font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50">Block</button>
            </div>
            <span className="text-slate-500 text-sm ml-2">Added on {new Date(candidate.createdAt?.toDate?.() || candidate.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-slate-500 hover:text-slate-900 font-medium text-sm border border-slate-200 px-4 py-2 rounded-xl"
        >
          Back to Dashboard
        </button>
      </div>

      {candidate.summary && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-2">AI Summary</h3>
          <p className="text-slate-700 leading-relaxed">{candidate.summary}</p>
        </div>
      )}

      {candidate.documentsMissing && candidate.documentsMissing.length > 0 && (
        <div className="bg-amber-50 p-6 rounded-2xl shadow-sm border border-amber-200">
          <h3 className="text-lg font-semibold text-amber-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={20} /> Missing Documents
          </h3>
          <p className="text-amber-800 text-sm mb-3">The following expected documents were not found in the upload bundle:</p>
          <ul className="flex flex-wrap gap-2 mb-4">
            {candidate.documentsMissing.map((doc: string) => (
              <li key={doc} className="bg-amber-100 text-amber-800 px-3 py-1 rounded-md text-sm font-medium capitalize border border-amber-200">
                {doc.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
          
          {(candidate.status === 'PENDING' || candidate.status === 'BLOCKED') && (
            <div className="mt-4 border border-amber-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="bg-amber-100 px-4 py-2 border-b border-amber-200 flex items-center gap-2">
                <Mail size={16} className="text-amber-700" />
                <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">Drafted Reminder Email</span>
              </div>
              <div className="p-4 bg-white whitespace-pre-wrap text-sm text-slate-700 font-serif leading-relaxed">
                {`Dear ${candidate.candidateName},\n\nWe are currently processing your onboarding documents. However, we noticed that the following required documents are missing from your submission:\n\n${candidate.documentsMissing.map((d: string) => `- ${d.replace(/_/g, ' ')}`).join('\n')}\n\nPlease provide these documents at your earliest convenience so we can proceed with your onboarding.\n\nBest regards,\nHR Team`}
              </div>
              <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => handleSendEmail('missing_docs')}
                  disabled={sentEmails['missing_docs']}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentEmails['missing_docs'] ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                >
                  {sentEmails['missing_docs'] ? <><Check size={14} /> Sent</> : <><Send size={14} /> Send Email</>}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Human Gate UI */}
      {(pendingCriticals.length > 0 || pendingWarnings.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-rose-200 overflow-hidden">
          <div className="bg-rose-50 px-6 py-4 border-b border-rose-200 flex items-center gap-3">
            <ShieldAlert className="text-rose-600" size={24} />
            <h3 className="text-lg font-semibold text-rose-900">HR Review Gate</h3>
            <span className="ml-auto text-sm text-rose-700 font-medium">Routing blocked until CRITICALs resolved</span>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500 uppercase tracking-wider">
                <th className="p-4">Severity</th>
                <th className="p-4">Document</th>
                <th className="p-4">Issue</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {flags.filter((f: any) => !f.resolution).map((flag: any, i: number) => {
                const flagId = flag.flag_id || flag.field || i.toString();
                return (
                  <tr key={flagId} className="hover:bg-slate-50">
                    <td className="p-4">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${flag.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                        {flag.severity}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-sm text-slate-600">{flag.source_doc}</td>
                    <td className="p-4">
                      <p className="font-medium text-slate-900">{flag.issue}</p>
                      <p className="text-sm text-slate-500 mt-1">Suggested: {flag.suggested_action}</p>
                    </td>
                    <td className="p-4 space-y-2">
                      <div className="flex gap-2">
                        <button onClick={() => handleFlagAction(flagId, 'APPROVED')} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg text-sm font-medium transition-colors">Approve</button>
                        <button onClick={() => handleFlagAction(flagId, 'REJECTED')} className="px-3 py-1.5 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded-lg text-sm font-medium transition-colors">Reject</button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Override note..."
                          value={overrideNotes[flagId] || ''}
                          onChange={(e) => setOverrideNotes({ ...overrideNotes, [flagId]: e.target.value })}
                          className="text-sm px-2 py-1 border border-slate-300 rounded-md w-full"
                        />
                        <button onClick={() => handleFlagAction(flagId, 'OVERRIDDEN')} className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-sm font-medium transition-colors">Override</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
            <button
              onClick={finalizeRouting}
              disabled={pendingCriticals.length > 0 || isRouting}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2 px-6 rounded-xl transition-colors"
            >
              {isRouting ? 'Processing...' : 'Proceed to Routing'} <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Routing Log */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <ArrowRight className="text-indigo-500" /> Routing Log & Next Steps
        </h3>
        {routingLog.length > 0 ? (
          <div className="space-y-4">
            {routingLog.map((route: any, i: number) => (
              <div key={i} className="flex flex-col p-4 rounded-xl border border-slate-100 bg-slate-50">
                <div className="flex items-start gap-4">
                  <div className="bg-indigo-100 text-indigo-700 p-2 rounded-lg mt-1">
                    <Check size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target Team</span>
                      <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-md">
                        {route.target}
                      </span>
                    </div>
                    <div className="mb-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">Action Required</span>
                      <p className="text-slate-800 font-medium">{route.action_required}</p>
                    </div>
                    
                    {route.payload?.draft_email && (
                      <div className="mb-4 border border-indigo-100 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-indigo-50 px-4 py-2 border-b border-indigo-100 flex items-center gap-2">
                          <Mail size={16} className="text-indigo-600" />
                          <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wider">Drafted Email</span>
                        </div>
                        <div className="p-4 bg-white whitespace-pre-wrap text-sm text-slate-700 font-serif leading-relaxed">
                          {route.payload.draft_email}
                        </div>
                        <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 flex justify-end">
                          <button 
                            onClick={() => handleSendEmail(i)}
                            disabled={sentEmails[i]}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentEmails[i] ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                          >
                            {sentEmails[i] ? <><Check size={14} /> Sent</> : <><Send size={14} /> Send Email</>}
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {Object.keys(route.payload || {}).filter(k => k !== 'draft_email').length > 0 && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                          <FileText size={16} className="text-slate-500" />
                          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Payload Details</span>
                        </div>
                        <div className="p-0">
                          <dl className="divide-y divide-slate-100">
                            {Object.entries(route.payload || {})
                              .filter(([key]) => key !== 'draft_email')
                              .map(([key, value]) => (
                              <div key={key} className="px-4 py-3 grid grid-cols-3 gap-4 hover:bg-slate-50 transition-colors">
                                <dt className="text-sm font-medium text-slate-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                                <dd className="text-sm text-slate-900 col-span-2">
                                  {typeof value === 'object' && value !== null ? (
                                    <ul className="list-disc list-inside space-y-1">
                                      {Array.isArray(value) ? value.map((v, idx) => (
                                        <li key={idx} className="text-slate-700">
                                          {typeof v === 'object' && v !== null ? Object.entries(v).map(([k2, v2]) => `${k2}: ${String(v2)}`).join(', ') : String(v)}
                                        </li>
                                      )) : Object.entries(value).map(([k, v]) => (
                                        <li key={k} className="text-slate-700"><span className="font-medium">{k}:</span> {String(v)}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-slate-700">{String(value)}</span>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 italic">No routing actions triggered yet. Resolve flags to proceed.</p>
        )}
      </div>

      {/* Extracted Data (Proper View) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <FileText className="text-slate-500" /> Extracted Data
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Object.entries(extractedData).map(([docType, data]: [string, any]) => (
            <div key={docType} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 capitalize flex items-center gap-2">
                <FileText size={16} className="text-indigo-500" />
                {docType.replace(/_/g, ' ')}
              </div>
              <div className="bg-white">
                <dl className="divide-y divide-slate-100">
                  {Object.entries(data || {}).map(([key, value]) => (
                    <div key={key} className="px-4 py-3 grid grid-cols-3 gap-4 hover:bg-slate-50 transition-colors">
                      <dt className="text-sm font-medium text-slate-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                      <dd className="text-sm text-slate-900 col-span-2 font-medium">
                        {value === null || value === undefined || value === '' ? (
                          <span className="text-slate-400 italic">Not found</span>
                        ) : typeof value === 'object' ? (
                          <ul className="list-disc list-inside space-y-1">
                            {Array.isArray(value) ? value.map((v, idx) => (
                              <li key={idx} className="text-slate-700">
                                {typeof v === 'object' ? Object.entries(v || {}).map(([k2, v2]) => `${k2}: ${String(v2)}`).join(', ') : String(v)}
                              </li>
                            )) : Object.entries(value || {}).map(([k, v]) => (
                              <li key={k} className="text-slate-700"><span className="font-medium">{k}:</span> {String(v)}</li>
                            ))}
                          </ul>
                        ) : (
                          String(value)
                        )}
                      </dd>
                    </div>
                  ))}
                  {Object.keys(data || {}).length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-slate-500 italic">
                      No data extracted for this document type.
                    </div>
                  )}
                </dl>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
