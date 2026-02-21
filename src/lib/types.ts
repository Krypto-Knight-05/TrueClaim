// ============================================================
// ClaimGuard AI — Type Definitions
// ============================================================

export interface ClaimItem {
  claim_id: string;
  patient_name: string;
  date: string;
  time: string;
  department: string;
  cpt_code: string;
  cpt_description: string;
  billed_amount_inr: number;
  recorded_clinical_notes: string;
  location_lat?: number;
  location_lng?: number;
}

export interface CPTCode {
  description: string;
  severity: number;
  avg_cost_inr: number;
  category: string;
}

export interface NCCIBundle {
  primary_code: string;
  bundled_codes: string[];
  bundle_description: string;
  correct_single_code: string;
  correct_description: string;
}

export interface CPTDatabase {
  codes: Record<string, CPTCode>;
  ncci_bundles: NCCIBundle[];
  severity_keywords: Record<string, string[]>;
}

// Feature 1: Cross-Modal Auditor results
export interface SeverityMismatch {
  claim_id: string;
  cpt_code: string;
  cpt_description: string;
  billed_severity: number;
  note_severity: number;
  severity_gap: number;
  billed_amount: number;
  evidence_text: string;
  highlighted_keywords: string[];
  explanation: string;
  department?: string; // Added for UI display
}

export interface CrossModalResult {
  mismatches: SeverityMismatch[];
  total_claims: number;
  flagged_count: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Feature 2: Timeline Detective results
export interface TimelineEvent {
  claim_id: string;
  start_time: string;
  end_time: string;
  department: string;
  procedure: string;
  location_lat?: number;
  location_lng?: number;
}

export interface TimelineOverlap {
  event_a: TimelineEvent;
  event_b: TimelineEvent;
  overlap_minutes: number;
  explanation: string;
  type: 'OVERLAP' | 'TELEPORTATION';
  required_speed_kmh?: number;
}

export interface TimelineResult {
  events: TimelineEvent[];
  overlaps: TimelineOverlap[];
  flagged_count: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Feature 3: Ghost & Unbundling results
export interface GhostService {
  claim_id: string;
  cpt_code: string;
  cpt_description: string;
  billed_amount: number;
  similarity_score: number;
  explanation: string;
}

export interface UnbundlingAlert {
  involved_claims: string[];
  involved_codes: string[];
  involved_descriptions: string[];
  total_billed: number;
  correct_code: string;
  correct_description: string;
  correct_cost: number;
  potential_savings: number;
  explanation: string;
}

export interface GhostUnbundleResult {
  ghost_services: GhostService[];
  unbundling_alerts: UnbundlingAlert[];
  total_potential_savings: number;
  flagged_count: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Feature 4: XAI Advisor results
export interface RiskFactor {
  name: string;
  contribution: number; // -1 to +1
  description: string;
  direction: 'RISK' | 'SAFE';
}

export interface XAIResult {
  risk_score: number; // 0-100
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  narrative: string;
  recommendation: 'APPROVE' | 'REVIEW' | 'REJECT' | 'ESCALATE';
  financial_summary: {
    billed_amount: number;
    expected_amount: number;
    potential_savings: number;
  };
}

// Combined analysis result
export interface FullAnalysisResult {
  patient_name: string;
  total_claims: number;
  total_billed: number;
  cross_modal: CrossModalResult;
  timeline: TimelineResult;
  ghost_unbundle: GhostUnbundleResult;
  xai: XAIResult;
  analysis_timestamp: string;
  claims: ClaimItem[]; // Added to pass full claim data to UI
}
