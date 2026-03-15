import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });

export type DocType = 'offer_letter' | 'resume' | 'id_proof' | 'background_check' | 'nda' | 'education_certificate' | 'tax_form' | 'unknown';

export interface ClassifiedDoc {
  doc_type: DocType;
  confidence: number;
  schema_hint: string[];
  reason?: string;
}

export interface ExtractedDoc {
  extracted: Record<string, any>;
  extraction_flags: Array<{
    field: string;
    issue: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
  }>;
}

export interface ReconciliationResult {
  reconciliation_issues: Array<{
    fields: string[];
    doc_a: string;
    doc_b: string;
    issue: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
  }>;
  consistent_fields: string[];
}

export interface RiskFlag {
  flag_id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  source: 'extraction' | 'reconciliation';
  source_doc: string;
  field: string;
  issue: string;
  suggested_action: string;
  resolution?: 'APPROVED' | 'REJECTED' | 'OVERRIDDEN';
  hr_note?: string;
}

export interface RiskResult {
  flags: RiskFlag[];
  summary: {
    critical_count: number;
    warning_count: number;
    info_count: number;
    onboarding_status: 'APPROVED' | 'PENDING' | 'BLOCKED';
  };
}

export interface RoutingAction {
  target: string;
  action_required: string;
  deadline?: string;
  payload: Record<string, any>;
}

export interface ReportResult {
  summary: string;
  onboarding_status: 'APPROVED' | 'PENDING' | 'BLOCKED';
  key_findings: string[];
  next_steps: string[];
}

// Helper to safely parse JSON from Gemini
function safeParseJSON(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e: any) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e2: any) {
        throw new Error(`Failed to parse JSON: ${e2.message}`);
      }
    }
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}

// Agent 1: Classifier
export async function classifyDocument(mimeType: string, base64Data: string): Promise<ClassifiedDoc> {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: `You are a document classification expert for an HR onboarding system.
Classify the document as exactly one of:
offer_letter | resume | id_proof | background_check | nda | education_certificate | tax_form

schema_hint should list the key fields you expect to be able to extract from this document type.
If confidence < 0.7, set doc_type to "unknown" and add a "reason": "<explanation>" field.` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          doc_type: { type: Type.STRING, enum: ['offer_letter', 'resume', 'id_proof', 'background_check', 'nda', 'education_certificate', 'tax_form', 'unknown'] },
          confidence: { type: Type.NUMBER },
          schema_hint: { type: Type.ARRAY, items: { type: Type.STRING } },
          reason: { type: Type.STRING }
        },
        required: ['doc_type', 'confidence', 'schema_hint']
      }
    }
  });

  return safeParseJSON(response.text || '{}') as ClassifiedDoc;
}

// Agent 2: Extractor
export async function extractDocument(mimeType: string, base64Data: string, docType: string, schemaHint: string[]): Promise<ExtractedDoc> {
  const today = new Date().toISOString().split('T')[0];
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: `You are an HR document extraction agent. You are processing a document of type: ${docType}
Extract ONLY the following fields from the document based on the hints: ${schemaHint.join(', ')}.
If a field is not present in the document, return null for that field — do NOT omit it.
The absence of a field is meaningful and must be captured.
CRITICAL: DO NOT include the original base64 string, raw document text, or any large text blocks in your output. Keep the extracted data concise and strictly structured.

After extracting, generate an extraction_flags array. Add a flag for each of:
- Any required field that is null
- Any expiry_date or end_date that is in the past (relative to today: ${today})
- Any signature field that is false or null
- Any date that seems inconsistent with others in this document
- Any numeric field (salary, allowances, reference_count) that is zero or unusually low

Each flag must follow this format:
{ "field": "<field_name>", "issue": "<description>", "severity": "CRITICAL|WARNING|INFO" }

Severity guide:
- CRITICAL: missing required field, expired document, unsigned required signature
- WARNING: unusual value, minor inconsistency, low reference count
- INFO: optional field missing, minor formatting issue

Return a JSON object with exactly this structure:
{
  "extracted": {
    "field1": "value1",
    "field2": "value2"
  },
  "extraction_flags": [
    {
      "field": "field_name",
      "issue": "description",
      "severity": "CRITICAL"
    }
  ]
}` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json'
    }
  });

  return safeParseJSON(response.text || '{}') as ExtractedDoc;
}

// Agent 3: Reconciler
export async function reconcileDocuments(extractedDocs: Record<string, any>): Promise<ReconciliationResult> {
  const today = new Date().toISOString().split('T')[0];
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `You are a cross-document reconciliation agent for an HR onboarding system.
You will receive extracted structured data from multiple documents that all belong to the same candidate.

Your task: identify inconsistencies ACROSS documents.
Reason carefully. A minor name variation ("Jon" vs "Jonathan") is a WARNING.
A completely different last name is a CRITICAL. Context matters.

Check ALL of the following cross-document pairs:
1. Full name — consistency across all documents
2. Start date (offer_letter) — must be in the future relative to today: ${today}
3. Role/title — offer_letter vs resume (most recent role)
4. Graduation year — resume education[] vs education_certificate
5. Employer information — tax_form employer vs offer_letter company
6. Background check date — must be within 90 days of today
7. NDA signature date — should be on or after offer letter date
8. Address — id_proof vs tax_form (if present in both)

Documents:
${JSON.stringify(extractedDocs, null, 2)}` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reconciliation_issues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fields: { type: Type.ARRAY, items: { type: Type.STRING } },
                doc_a: { type: Type.STRING },
                doc_b: { type: Type.STRING },
                issue: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['CRITICAL', 'WARNING', 'INFO'] }
              },
              required: ['fields', 'doc_a', 'doc_b', 'issue', 'severity']
            }
          },
          consistent_fields: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['reconciliation_issues', 'consistent_fields']
      }
    }
  });

  return safeParseJSON(response.text || '{}') as ReconciliationResult;
}

// Agent 4: Risk Flagger
export async function flagRisks(extractionFlags: any[], reconciliationIssues: any[], startDate?: string): Promise<RiskResult> {
  const today = new Date().toISOString().split('T')[0];
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `You are a risk assessment agent for an HR onboarding pipeline.
Your tasks:
1. Merge the two lists, removing true duplicates (same field, same issue, same document)
2. Re-score severity if context changes it
3. Add context-aware reasoning to each flag's suggested_action

Today's date: ${today}
Candidate start date: ${startDate || 'Unknown'}

Extraction flags:
${JSON.stringify(extractionFlags, null, 2)}

Reconciliation issues:
${JSON.stringify(reconciliationIssues, null, 2)}

onboarding_status rules:
- APPROVED: zero CRITICAL flags
- BLOCKED: one or more CRITICAL flags
- PENDING: no CRITICAL but one or more WARNING flags that require verification` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          flags: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                flag_id: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['CRITICAL', 'WARNING', 'INFO'] },
                source: { type: Type.STRING, enum: ['extraction', 'reconciliation'] },
                source_doc: { type: Type.STRING },
                field: { type: Type.STRING },
                issue: { type: Type.STRING },
                suggested_action: { type: Type.STRING }
              },
              required: ['flag_id', 'severity', 'source', 'source_doc', 'field', 'issue', 'suggested_action']
            }
          },
          summary: {
            type: Type.OBJECT,
            properties: {
              critical_count: { type: Type.NUMBER },
              warning_count: { type: Type.NUMBER },
              info_count: { type: Type.NUMBER },
              onboarding_status: { type: Type.STRING, enum: ['APPROVED', 'PENDING', 'BLOCKED'] }
            },
            required: ['critical_count', 'warning_count', 'info_count', 'onboarding_status']
          }
        },
        required: ['flags', 'summary']
      }
    }
  });

  return safeParseJSON(response.text || '{}') as RiskResult;
}

// Agent 5: Router
export async function routeActions(candidateProfile: Record<string, any>, resolvedFlags: any[], onboardingStatus: string, documentsMissing: string[] = []): Promise<{ routing: RoutingAction[] }> {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `You are a routing agent for an HR onboarding system.
Given the approved candidate profile and resolved HR flags below,
determine exactly which teams need to be notified and what information each team needs.
Do NOT send full document bundles. Send only what each team needs to take action.

Available routing targets:
- Legal: receives NDA status, background check result, policy compliance flags
- Payroll: receives verified W-4 fields, offer letter salary and start date
- IT_Provisioning: receives start date, role, manager, department (only if APPROVED)
- Hiring_Manager: receives candidate summary, start date, INFO-level notes (only if APPROVED). MUST include a 'draft_email' field in the payload with a welcome/update message.
- Candidate_Onboarding: receives next steps. MUST include a 'draft_email' field in the payload welcoming them and outlining next steps.
- HR_Remediation: receives list of unresolved WARNING flags with suggested next steps
- Applicant: MUST include a 'draft_email' field in the payload. If status is APPROVED, welcome them to the team. If PENDING or BLOCKED, notify them about missing documents or unresolved issues that require their attention.

Candidate profile:
${JSON.stringify(candidateProfile, null, 2)}

Resolved flags:
${JSON.stringify(resolvedFlags, null, 2)}

Missing Documents:
${JSON.stringify(documentsMissing, null, 2)}

Onboarding status: ${onboardingStatus}

Return a JSON object with exactly this structure:
{
  "routing": [
    {
      "target": "Team_Name",
      "action_required": "Description",
      "deadline": "YYYY-MM-DD",
      "payload": {
        "key1": "value1"
      }
    }
  ]
}` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json'
    }
  });

  return safeParseJSON(response.text || '{}') as { routing: RoutingAction[] };
}

// Agent 6: Reporter
export async function generateReport(fullPipelineOutput: Record<string, any>): Promise<ReportResult> {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `You are a report generation agent for an HR onboarding pipeline.
Generate a plain-English summary of:
1. The candidate's onboarding status and why
2. Key findings from document processing (highlight anything noteworthy)
3. Any flags that were raised and how they were resolved

Keep the summary concise — 3 to 5 sentences maximum.
Write for an HR manager who will scan this in 30 seconds.

Candidate data:
${JSON.stringify(fullPipelineOutput, null, 2)}` }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          onboarding_status: { type: Type.STRING, enum: ['APPROVED', 'PENDING', 'BLOCKED'] },
          key_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          next_steps: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['summary', 'onboarding_status', 'key_findings', 'next_steps']
      }
    }
  });

  return safeParseJSON(response.text || '{}') as ReportResult;
}
