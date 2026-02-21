// ============================================================
// Feature 1: Cross-Modal Auditor — Upcoding Detection
// Compares billing severity vs. clinical note severity
// When notes are absent, infers clinical picture from other CPT codes
// ============================================================

import { ClaimItem, CPTDatabase, CrossModalResult, SeverityMismatch } from '../types';

/**
 * Analyze clinical notes text to determine severity level (1-5)
 */
function extractNoteSeverity(notes: string, severityKeywords: Record<string, string[]>): { level: number; keywords: string[] } {
    const lowerNotes = notes.toLowerCase();
    const foundKeywords: string[] = [];
    let maxLevel = 1;

    // Check from highest severity down
    for (let level = 5; level >= 1; level--) {
        const keywords = severityKeywords[level.toString()] || [];
        for (const kw of keywords) {
            if (lowerNotes.includes(kw.toLowerCase())) {
                foundKeywords.push(kw);
                if (level > maxLevel) maxLevel = level;
            }
        }
    }

    // Only treat as "no evidence" if the notes are extremely short or
    // explicitly say "no record found" / "no clinical notes available"
    if (lowerNotes.includes('no record found') || lowerNotes.includes('no clinical notes available')) {
        return { level: 0, keywords: ['NO RECORD FOUND'] };
    }

    // If mostly low severity keywords found, cap severity
    const lowCount = foundKeywords.filter(k => {
        for (const kw of [...(severityKeywords['1'] || []), ...(severityKeywords['2'] || [])]) {
            if (k.toLowerCase() === kw.toLowerCase()) return true;
        }
        return false;
    }).length;

    const highCount = foundKeywords.filter(k => {
        for (const kw of [...(severityKeywords['4'] || []), ...(severityKeywords['5'] || [])]) {
            if (k.toLowerCase() === kw.toLowerCase()) return true;
        }
        return false;
    }).length;

    // If mostly low keywords, cap severity
    if (lowCount > highCount && maxLevel > 2) {
        maxLevel = 2;
    }

    return { level: maxLevel, keywords: foundKeywords };
}

/**
 * Check whether a specific billed service has supporting evidence in the clinical notes.
 * Returns true if the notes contain terms that support this service was performed.
 */
function checkServiceEvidence(cptCode: string, cptDescription: string, notes: string): boolean {
    const lowerNotes = notes.toLowerCase();
    const lowerDesc = cptDescription.toLowerCase();

    // Extract key terms from the CPT description
    const descTerms = lowerDesc.split(/[\s,\-—()\/]+/).filter(t => t.length >= 3);

    // Check if at least 2 meaningful description terms appear in notes
    let matchCount = 0;
    for (const term of descTerms) {
        // Skip generic terms
        if (['the', 'and', 'with', 'level', 'visit', 'established', 'patient', 'low', 'high'].includes(term)) continue;
        if (lowerNotes.includes(term)) matchCount++;
    }

    // Special patterns: check for CPT-specific evidence
    const evidencePatterns: Record<string, string[]> = {
        '99285': ['emergency', 'life threatening', 'critical', 'unstable', 'code blue', 'resuscitation'],
        '99284': ['emergency', 'high severity', 'urgent', 'acute'],
        '99283': ['emergency', 'moderate'],
        '73600': ['x-ray', 'xray', 'x ray', 'ankle', 'radiograph'],
        '70553': ['mri', 'brain', 'magnetic resonance', 'contrast', 'neurological'],
        '99070': ['supplies', 'brace', 'material', 'medication', 'med', 'ankle brace', 'tab.', 'tablet'],
        '99213': ['office visit', 'follow-up', 'follow up', 'outpatient', 'review'],
        '99214': ['office visit', 'moderate complexity'],
        '49320': ['laparoscop', 'exploratory', 'scope'],
        '44950': ['appendectomy', 'appendix'],
        '44970': ['laparoscopic appendectomy'],
        '12001': ['suture', 'wound', 'closure'],
    };

    const patterns = evidencePatterns[cptCode] || [];
    let patternMatches = 0;
    for (const p of patterns) {
        if (lowerNotes.includes(p)) patternMatches++;
    }

    // Service has evidence if: 2+ description terms match OR 1+ specific pattern matches
    return matchCount >= 2 || patternMatches >= 1;
}


/**
 * Body-area detection categories for cross-referencing services
 */
const BODY_AREA_KEYWORDS: Record<string, string[]> = {
    'ankle': ['ankle', '73600', '73610', '73620'],
    'brain': ['brain', 'cerebral', 'cranial', '70553', '70551', '70552'],
    'abdomen': ['abdomen', 'abdominal', 'appendix', 'laparoscop', '49320', '44950', '44970'],
    'chest': ['chest', 'thorax', 'pulmonary', 'cardiac', 'heart'],
    'spine': ['spine', 'spinal', 'lumbar', 'cervical', 'thoracic'],
    'knee': ['knee', 'patellar', '73721', '73560'],
    'shoulder': ['shoulder', 'rotator', 'acromial'],
    'hip': ['hip', 'femoral', 'acetabular'],
    'wrist': ['wrist', 'carpal', '73100'],
};

/**
 * Infer the dominant body area / clinical picture from all claims
 * Only counts severity from services in the dominant body area
 */
function inferClinicalPicture(claims: ClaimItem[], cptDb: CPTDatabase): {
    dominantAreas: string[];
    maxSupportedSeverity: number;
    inferredDescription: string;
} {
    const areaCounts: Record<string, number> = {};
    const areaSeverities: Record<string, number> = {};
    const allDescriptions: string[] = [];

    // First pass: determine body areas and their severities
    for (const c of claims) {
        const desc = c.cpt_description.toLowerCase();
        allDescriptions.push(desc);
        const cptInfo = cptDb.codes[c.cpt_code];

        // Skip E&M codes — those are what we validate
        if (cptInfo && cptInfo.category === 'E&M') continue;

        for (const [area, keywords] of Object.entries(BODY_AREA_KEYWORDS)) {
            for (const kw of keywords) {
                if (desc.includes(kw) || c.cpt_code === kw) {
                    areaCounts[area] = (areaCounts[area] || 0) + 1;
                    const sev = cptInfo?.severity || 1;
                    areaSeverities[area] = Math.max(areaSeverities[area] || 0, sev);
                    break;
                }
            }
        }
    }

    // Find the dominant area (highest count of services)
    const sortedAreas = Object.entries(areaCounts)
        .sort((a, b) => b[1] - a[1]);

    const dominantAreas = sortedAreas.map(([area]) => area);
    const dominantArea = dominantAreas[0];

    // Use severity ONLY from the dominant body area
    // This prevents outlier services (e.g., MRI Brain in an ankle case) from inflating severity
    let maxSupportedSev = 1;
    if (dominantArea && areaSeverities[dominantArea] !== undefined) {
        maxSupportedSev = areaSeverities[dominantArea];
    } else {
        // Fallback: use minimum severity across all non-E&M services
        for (const c of claims) {
            const cptInfo = cptDb.codes[c.cpt_code];
            if (cptInfo && cptInfo.category !== 'E&M' && cptInfo.category !== 'Supplies') {
                maxSupportedSev = Math.max(maxSupportedSev, cptInfo.severity);
            }
        }
    }

    return {
        dominantAreas,
        maxSupportedSeverity: maxSupportedSev,
        inferredDescription: allDescriptions.join('; '),
    };
}

/**
 * Generate human-readable explanation for the mismatch
 */
function generateExplanation(claim: ClaimItem, billedSeverity: number, noteSeverity: number, keywords: string[], inferredContext?: string): string {
    const gap = billedSeverity - noteSeverity;

    if (noteSeverity === 0) {
        return `The billing code '${claim.cpt_code}' (${claim.cpt_description}) has no supporting clinical documentation. The notes explicitly indicate no service was performed or required.`;
    }

    const contextNote = inferredContext ? ` Clinical picture inferred from billing data: ${inferredContext}.` : '';

    if (gap >= 3) {
        return `CRITICAL MISMATCH: The billing code '${claim.cpt_code}' indicates Level ${billedSeverity} severity (${claim.cpt_description}), but clinical evidence suggests Level ${noteSeverity} severity. Keywords found: "${keywords.join('", "')}". This is a Level ${gap} discrepancy — strong indicator of upcoding.${contextNote}`;
    }

    if (gap >= 2) {
        return `SIGNIFICANT MISMATCH: Code '${claim.cpt_code}' billed at severity Level ${billedSeverity} (${claim.cpt_description}), but evidence indicates Level ${noteSeverity}. Evidence: "${keywords.join('", "')}". Gap of ${gap} levels suggests potential upcoding.${contextNote}`;
    }

    return `Minor discrepancy: Code '${claim.cpt_code}' billed at Level ${billedSeverity}, evidence suggests Level ${noteSeverity}. Within acceptable range.`;
}

/**
 * Run the Cross-Modal Auditor on a set of claims
 */
export function runCrossModalAudit(claims: ClaimItem[], cptDb: CPTDatabase): CrossModalResult {
    const mismatches: SeverityMismatch[] = [];
    const hasAnyNotes = claims.some(c => c.recorded_clinical_notes && c.recorded_clinical_notes.trim().length > 0);

    // Infer clinical picture from the overall billing data
    const clinicalPicture = inferClinicalPicture(claims, cptDb);

    for (const claim of claims) {
        const cptInfo = cptDb.codes[claim.cpt_code];
        if (!cptInfo) continue;

        const billedSeverity = cptInfo.severity;

        // ── Path A: Clinical notes exist — compare directly ──
        if (claim.recorded_clinical_notes && claim.recorded_clinical_notes.trim().length > 0) {
            const noteAnalysis = extractNoteSeverity(claim.recorded_clinical_notes, cptDb.severity_keywords);
            const hasEvidence = checkServiceEvidence(claim.cpt_code, claim.cpt_description, claim.recorded_clinical_notes);
            const gap = billedSeverity - noteAnalysis.level;

            // Flag if:
            // 1. Service has NO evidence in notes (ghost-like) — regardless of severity
            // 2. Severity gap ≥ 3 (strong upcoding signal) — even if some evidence exists
            // 3. Severity gap ≥ 2 AND service has no evidence
            const shouldFlag = (!hasEvidence && billedSeverity >= 2) || (gap >= 3) || (gap >= 2 && !hasEvidence);

            if (shouldFlag) {
                const effectiveNoteSeverity = hasEvidence ? noteAnalysis.level : Math.min(noteAnalysis.level, 1);
                const effectiveGap = billedSeverity - effectiveNoteSeverity;
                mismatches.push({
                    claim_id: claim.claim_id,
                    cpt_code: claim.cpt_code,
                    cpt_description: claim.cpt_description,
                    billed_severity: billedSeverity,
                    note_severity: effectiveNoteSeverity,
                    severity_gap: effectiveGap,
                    billed_amount: claim.billed_amount_inr,
                    evidence_text: claim.recorded_clinical_notes,
                    highlighted_keywords: hasEvidence ? noteAnalysis.keywords : ['No specific evidence found for this service'],
                    explanation: hasEvidence
                        ? generateExplanation(claim, billedSeverity, noteAnalysis.level, noteAnalysis.keywords)
                        : `MISSING DOCUMENTATION: The billed service "${claim.cpt_description}" (${claim.cpt_code}) has no supporting mention in the clinical documentation. The notes describe different procedures/conditions.`,
                    department: claim.department,
                });
            }
            continue;
        }

        // ── Path B: No clinical notes — infer from billing context ──
        // Only check E&M codes (visit severity) since those are what get upcoded
        if (cptInfo.category !== 'E&M') continue;
        if (billedSeverity <= 2) continue; // Low-severity E&M codes are already fine

        // Compare billed E&M severity vs. the max severity of supporting procedures
        // E.g., if most expensive procedure is X-Ray ankle (sev 1), billing 99285 (sev 5) is suspicious
        const inferredSeverity = Math.min(clinicalPicture.maxSupportedSeverity + 1, 5);
        const gap = billedSeverity - inferredSeverity;

        if (gap >= 2) {
            const evidence = claims
                .filter(c => c.claim_id !== claim.claim_id && cptDb.codes[c.cpt_code]?.category !== 'E&M')
                .map(c => `${c.cpt_code} (${c.cpt_description}, severity ${cptDb.codes[c.cpt_code]?.severity || '?'})`)
                .join(', ');

            const inferKeywords = [
                `Supporting procedures max severity: ${clinicalPicture.maxSupportedSeverity}`,
                `Dominant body areas: ${clinicalPicture.dominantAreas.join(', ') || 'general'}`,
            ];

            mismatches.push({
                claim_id: claim.claim_id,
                cpt_code: claim.cpt_code,
                cpt_description: claim.cpt_description,
                billed_severity: billedSeverity,
                note_severity: inferredSeverity,
                severity_gap: gap,
                billed_amount: claim.billed_amount_inr,
                evidence_text: hasAnyNotes ? '' : `Inferred from billing context: ${evidence}`,
                highlighted_keywords: inferKeywords,
                explanation: generateExplanation(
                    claim,
                    billedSeverity,
                    inferredSeverity,
                    inferKeywords,
                    `Other billed services (${evidence}) indicate a low-acuity visit`
                ),
            });
        }
    }

    const flaggedCount = mismatches.length;
    let riskLevel: CrossModalResult['risk_level'] = 'LOW';
    if (flaggedCount >= 3) riskLevel = 'CRITICAL';
    else if (flaggedCount >= 2) riskLevel = 'HIGH';
    else if (flaggedCount >= 1) riskLevel = 'MEDIUM';

    return {
        mismatches,
        total_claims: claims.length,
        flagged_count: flaggedCount,
        risk_level: riskLevel,
    };
}
