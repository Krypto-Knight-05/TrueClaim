// ============================================================
// Orchestrator — Runs all 4 analysis engines on a claim
// ============================================================

import { ClaimItem, CPTDatabase, FullAnalysisResult } from '../types';
import { runCrossModalAudit } from './cross-modal-auditor';
import { runTimelineDetective } from './timeline-detective';
import { runGhostUnbundleHunter } from './ghost-unbundle-hunter';
import { runXAIAdvisor } from './xai-advisor';

/**
 * Run the complete analysis pipeline on a set of claims
 */
export function analyzeFullClaim(claims: ClaimItem[], cptDb: CPTDatabase): FullAnalysisResult {
    // Run each engine
    const crossModal = runCrossModalAudit(claims, cptDb);
    const timeline = runTimelineDetective(claims, cptDb);
    const ghostUnbundle = runGhostUnbundleHunter(claims, cptDb);
    const xai = runXAIAdvisor(crossModal, timeline, ghostUnbundle, claims, cptDb);

    return {
        patient_name: claims[0]?.patient_name || 'Unknown',
        total_claims: claims.length,
        total_billed: claims.reduce((sum, c) => sum + c.billed_amount_inr, 0),
        cross_modal: crossModal,
        timeline: timeline,
        ghost_unbundle: ghostUnbundle,
        xai: xai,
        analysis_timestamp: new Date().toISOString(),
        claims: claims,
    };
}
