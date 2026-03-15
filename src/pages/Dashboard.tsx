import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { FileText, Plus, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

export default function Dashboard() {
  const { user, role } = useAuth();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user || !role) return;
    const q = query(collection(db, 'candidates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCandidates(data);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'candidates');
      } catch (handledErr) {
        setError(handledErr as Error);
      }
    });
    return () => unsubscribe();
  }, [user, role]);

  if (error) throw error;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Candidates</h2>
        <Link
          to="/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-xl transition-colors"
        >
          <Plus size={20} />
          New Candidate
        </Link>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500 uppercase tracking-wider">
              <th className="p-4">Name</th>
              <th className="p-4">Status</th>
              <th className="p-4">Documents</th>
              <th className="p-4">Flags</th>
              <th className="p-4">Added</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {candidates.map((candidate) => (
              <tr key={candidate.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-900">{candidate.candidateName}</td>
                <td className="p-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    candidate.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                    candidate.status === 'BLOCKED' ? 'bg-rose-100 text-rose-800' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {candidate.status === 'APPROVED' && <CheckCircle size={14} />}
                    {candidate.status === 'BLOCKED' && <AlertTriangle size={14} />}
                    {candidate.status === 'PENDING' && <Clock size={14} />}
                    {candidate.status}
                  </span>
                </td>
                <td className="p-4 text-slate-500 text-sm">
                  {candidate.documentsReceived?.length || 0} / 7
                </td>
                <td className="p-4">
                  {(() => {
                    const flags = JSON.parse(candidate.flags || '[]');
                    const criticalCount = flags.filter((f: any) => f.severity === 'CRITICAL' && f.resolution !== 'APPROVED' && f.resolution !== 'OVERRIDDEN').length;
                    const warningCount = flags.filter((f: any) => f.severity === 'WARNING' && f.resolution !== 'APPROVED' && f.resolution !== 'OVERRIDDEN').length;
                    return (
                      <div className="flex gap-2">
                        {criticalCount > 0 && <span className="text-xs font-medium bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md">{criticalCount} CRITICAL</span>}
                        {warningCount > 0 && <span className="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">{warningCount} WARNING</span>}
                        {criticalCount === 0 && warningCount === 0 && <span className="text-xs text-slate-400">None</span>}
                      </div>
                    );
                  })()}
                </td>
                <td className="p-4 text-slate-500 text-sm">
                  {candidate.createdAt?.toDate ? format(candidate.createdAt.toDate(), 'MMM d, yyyy') : 'N/A'}
                </td>
                <td className="p-4 text-right">
                  <Link
                    to={`/candidate/${candidate.id}`}
                    className="text-indigo-600 hover:text-indigo-800 font-medium text-sm"
                  >
                    View Details
                  </Link>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  <FileText size={48} className="mx-auto mb-4 text-slate-300" />
                  <p>No candidates found. Add a new candidate to get started.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
