import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { UploadCloud, FileText, CheckCircle, Loader2, AlertCircle, Eye, X } from 'lucide-react';
import { classifyDocument, extractDocument, reconcileDocuments, flagRisks, routeActions, generateReport } from '../services/pipeline';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

export default function NewCandidate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [candidateName, setCandidateName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; details: string }>({ stage: '', details: '' });
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{file: File, url: string, content?: string} | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:application/pdf;base64, part
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handlePreview = async (file: File) => {
    const url = URL.createObjectURL(file);
    if (file.type === 'text/plain') {
      const text = await file.text();
      setPreviewFile({ file, url, content: text });
    } else {
      setPreviewFile({ file, url });
    }
  };

  useEffect(() => {
    return () => {
      if (previewFile) URL.revokeObjectURL(previewFile.url);
    };
  }, [previewFile]);

  const processPipeline = async () => {
    if (!candidateName || files.length === 0 || !startDate) {
      setError('Please provide a candidate name, start date, and upload at least one document.');
      return;
    }
    setError(null);
    setIsProcessing(true);

    try {
      const extractedData: Record<string, any> = {};
      const allExtractionFlags: any[] = [];
      const documentsReceived: string[] = [];

      // Stage 1 & 2: Classify and Extract sequentially to avoid rate limits
      setProgress({ stage: 'Classification & Extraction', details: 'Analyzing documents...' });
      
      for (const file of files) {
        setProgress({ stage: 'Classification & Extraction', details: `Processing ${file.name}...` });
        const base64 = await fileToBase64(file);
        const mimeType = file.type || 'application/pdf';

        // Agent 1: Classify
        const classification = await classifyDocument(mimeType, base64);
        
        if (classification.doc_type === 'unknown') {
          allExtractionFlags.push({
            field: 'document',
            issue: `Could not classify document ${file.name}: ${classification.reason}`,
            severity: 'CRITICAL'
          });
          continue;
        }

        documentsReceived.push(classification.doc_type);

        // Agent 2: Extract
        const extraction = await extractDocument(mimeType, base64, classification.doc_type, classification.schema_hint);
        extractedData[classification.doc_type] = extraction.extracted;
        
        // Add source doc to flags
        const flagsWithSource = extraction.extraction_flags.map(f => ({ ...f, source_doc: classification.doc_type, source: 'extraction' }));
        allExtractionFlags.push(...flagsWithSource);
      }

      // Stage 3: Reconcile
      setProgress({ stage: 'Reconciliation', details: 'Cross-checking documents...' });
      const reconciliation = await reconcileDocuments(extractedData);
      const reconciliationIssues = reconciliation.reconciliation_issues.map(i => ({ ...i, source: 'reconciliation' }));

      // Stage 4: Risk Flagging
      setProgress({ stage: 'Risk Assessment', details: 'Evaluating flags and severity...' });
      const riskResult = await flagRisks(allExtractionFlags, reconciliationIssues, startDate);

      // Stage 5: Human Gate (We save to Firestore here, and HR reviews it later)
      // We also run Agent 5 & 6 optimistically, but they might need to be re-run after HR review.
      // For now, we save the initial state.
      
      setProgress({ stage: 'Routing & Reporting', details: 'Generating final report...' });
      const documentsMissing = ['offer_letter', 'resume', 'id_proof', 'background_check', 'nda', 'education_certificate', 'tax_form'].filter(d => !documentsReceived.includes(d));
      
      const [routingResult, reportResult] = await Promise.all([
        routeActions(extractedData, riskResult.flags, riskResult.summary.onboarding_status, documentsMissing),
        generateReport({
          extractedData,
          flags: riskResult.flags,
          status: riskResult.summary.onboarding_status
        })
      ]);

      // Save to Firestore
      setProgress({ stage: 'Saving', details: 'Storing candidate profile...' });
      const candidateDoc = {
        candidateName,
        status: riskResult.summary.onboarding_status,
        summary: reportResult.summary,
        documentsReceived,
        documentsMissing,
        extractedData: JSON.stringify(extractedData),
        flags: JSON.stringify(riskResult.flags),
        routingLog: JSON.stringify(routingResult.routing),
        auditTrail: JSON.stringify([]),
        hrId: user?.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'candidates'), candidateDoc);
      
      setIsProcessing(false);
      navigate(`/candidate/${docRef.id}`);

    } catch (err: any) {
      console.error(err);
      if (err?.code || err?.name === 'FirebaseError' || err?.message?.includes('permission-denied')) {
        try {
          handleFirestoreError(err, OperationType.CREATE, 'candidates');
        } catch (handledErr: any) {
          setError(handledErr.message || 'An error occurred during processing.');
        }
      } else {
        setError(err.message || 'An error occurred during processing.');
      }
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900">New Candidate Onboarding</h2>
        <p className="text-slate-500 mt-2">Upload document bundle to begin the automated extraction and verification pipeline.</p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={20} />
          <p>{error}</p>
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Candidate Name</label>
            <input
              type="text"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              placeholder="e.g. Sarah Chen"
              disabled={isProcessing}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Expected Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              disabled={isProcessing}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Document Bundle (PDF, TXT, Images)</label>
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center hover:bg-slate-50 transition-colors relative">
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={isProcessing}
              accept=".pdf,.txt,.png,.jpg,.jpeg"
            />
            <UploadCloud size={48} className="mx-auto text-indigo-400 mb-4" />
            <p className="text-slate-700 font-medium">Drag & drop documents here, or click to select</p>
            <p className="text-slate-500 text-sm mt-1">Supports Offer Letter, Resume, ID, Background Check, NDA, Education Cert, W-4</p>
          </div>
        </div>

        {files.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
              <FileText size={16} />
              {files.length} Documents Selected
            </h4>
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li key={i} className="text-sm text-slate-600 flex items-center justify-between bg-white p-2 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span className="font-medium">{f.name}</span> <span className="text-slate-400">({Math.round(f.size / 1024)} KB)</span>
                  </div>
                  <button 
                    onClick={() => handlePreview(f)}
                    className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors"
                  >
                    <Eye size={14} /> Preview
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-4 border-t border-slate-200">
          <button
            onClick={processPipeline}
            disabled={isProcessing || files.length === 0 || !candidateName || !startDate}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-3 px-4 rounded-xl transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Processing Pipeline...
              </>
            ) : (
              'Process Documents'
            )}
          </button>
        </div>
      </div>

      {isProcessing && (
        <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl">
          <div className="flex items-center gap-4 mb-2">
            <Loader2 size={24} className="text-indigo-600 animate-spin" />
            <h3 className="text-lg font-semibold text-indigo-900">{progress.stage}</h3>
          </div>
          <p className="text-indigo-700 ml-10">{progress.details}</p>
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <FileText size={18} className="text-indigo-500" />
                {previewFile.file.name}
              </h3>
              <button 
                onClick={() => setPreviewFile(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-100/50">
              {previewFile.file.type.startsWith('image/') ? (
                <img src={previewFile.url} alt="Preview" className="max-w-full h-auto mx-auto rounded-lg shadow-sm" />
              ) : previewFile.file.type === 'application/pdf' ? (
                <iframe src={previewFile.url} className="w-full h-[70vh] border-0 rounded-lg shadow-sm bg-white" title="PDF Preview" />
              ) : previewFile.content ? (
                <pre className="whitespace-pre-wrap text-sm text-slate-700 font-mono bg-white p-6 rounded-lg shadow-sm border border-slate-200">{previewFile.content}</pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                  <FileText size={48} className="mb-4 text-slate-300" />
                  <p>Preview not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
