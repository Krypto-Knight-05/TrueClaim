// ============================================================
// Feature 3: Ghost & Unbundling Hunter
// Detects phantom charges and unbundled billing
// When notes are absent, detects unrelated body-area services
// ============================================================

import { ClaimItem, CPTDatabase, GhostService, GhostUnbundleResult, UnbundlingAlert } from '../types';

// Keyword synonym groups for semantic matching
const SEMANTIC_GROUPS: Record<string, string[]> = {
    'mri': ['mri', 'magnetic resonance', 'tesla', 't1-weighted', 't2-weighted', 'flair', 'stir', 'mri brain', 'axial', 'sagittal', 'coronal'],
    'xray': ['x-ray', 'xray', 'radiograph', 'film', 'views', 'ap ', 'lateral'],
    'ct': ['ct scan', 'computed tomography', 'cat scan'],
    'surgery': ['surgery', 'surgical', 'incision', 'excision', 'resection', 'operation', 'operat'],
    'appendectomy': ['appendix', 'appendectomy', 'appendiceal', 'cecum'],
    'laparoscopy': ['laparoscop', 'trocar', 'abdomen inflated', 'scope', 'minimally invasive'],
    'suture': ['suture', 'stitch', 'closure', 'wound closure', 'closed with'],
    'physio': ['physiotherapy', 'physical therapy', 'exercise', 'rehabilitation', 'rehab', 'therapeutic exercise'],
    'pharmacy': ['medication', 'drug', 'prescribed', 'tablet', 'capsule', 'brace', 'supplies', 'tab', 'rice', 'ice', 'compression', 'ibuprofen', 'mg ', 'bd ', ' x '],
    'emergency': ['emergency', 'ed visit', 'er visit', 'trauma', 'acute presentation', 'triage', 'resuscitation', 'emergency department'],
    'brain': ['brain', 'cerebral', 'cranial', 'neurological', 'head', 'neuro', 'mental status', 'consciousness'],
};

/**
 * Body-area detection for ghost service inference
 * Maps CPT codes and description keywords to body areas
 */
const BODY_AREA_MAP: Record<string, { codes: string[]; keywords: string[] }> = {
    'ankle/foot': { codes: ['73600', '73610', '73620', '73630'], keywords: ['ankle', 'foot', 'tarsal', 'metatarsal'] },
    'knee': { codes: ['73560', '73721', '27447'], keywords: ['knee', 'patellar', 'tibial'] },
    'hip': { codes: ['73501', '73721'], keywords: ['hip', 'femoral', 'acetabulum'] },
    'brain/head': { codes: ['70553', '70551', '70552', '70540'], keywords: ['brain', 'head', 'cranial', 'cerebral', 'neurological'] },
    'abdomen': { codes: ['49320', '44950', '44970', '74177'], keywords: ['abdomen', 'abdominal', 'appendix', 'laparoscop', 'bowel'] },
    'chest': { codes: ['71046', '71275'], keywords: ['chest', 'thorax', 'pulmonary', 'cardiac', 'lung'] },
    'spine': { codes: ['72148', '72141'], keywords: ['spine', 'spinal', 'lumbar', 'cervical', 'vertebral'] },
    'wrist/hand': { codes: ['73100', '73110', '73120'], keywords: ['wrist', 'hand', 'carpal', 'metacarpal'] },
    'shoulder': { codes: ['73221', '23472'], keywords: ['shoulder', 'rotator', 'acromial', 'clavicle'] },
};

// Generic categories that can appear with any body area (not flagged)
const GENERIC_CATEGORIES = ['E&M', 'Supplies', 'Physical Therapy'];

/**
 * Determine the body area for a claim
 */
function getBodyArea(cptCode: string, description: string): string | null {
    const lowerDesc = description.toLowerCase();
    for (const [area, mapping] of Object.entries(BODY_AREA_MAP)) {
        if (mapping.codes.includes(cptCode)) return area;
        for (const kw of mapping.keywords) {
            if (lowerDesc.includes(kw)) return area;
        }
    }
    return null; // generic / could be anything
}

/**
 * Get relevant semantic group for a CPT description
 */
function getRelevantGroups(cptDescription: string): string[] {
    const lower = cptDescription.toLowerCase();
    const relevantGroups: string[] = [];

    for (const [group, keywords] of Object.entries(SEMANTIC_GROUPS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) {
                relevantGroups.push(group);
                break;
            }
        }
    }
    return relevantGroups;
}

/**
 * Calculate semantic similarity score between a CPT code and clinical notes
 */
function calculateSimilarity(cptDescription: string, notes: string): number {
    const relevantGroups = getRelevantGroups(cptDescription);
    if (relevantGroups.length === 0) return 0.5; // Unknown service, can't evaluate

    const lowerNotes = notes.toLowerCase();
    let matchCount = 0;
    let totalKeywords = 0;

    for (const group of relevantGroups) {
        const keywords = SEMANTIC_GROUPS[group];
        for (const kw of keywords) {
            totalKeywords++;
            if (lowerNotes.includes(kw)) {
                matchCount++;
            }
        }
    }

    // Check explicit denial patterns (but avoid blanket "no further" which might be innocent)
    if (lowerNotes.includes('no record found') || (lowerNotes.includes('not required') && lowerNotes.length < 100) || lowerNotes.includes('no clinical notes available')) {
        return 0.0;
    }

    return totalKeywords > 0 ? matchCount / totalKeywords : 0.5;
}

/**
 * Detect ghost (phantom) services — billed items with no clinical evidence
 * Works with clinical notes (text matching) and without (body area analysis)
 */
function detectGhostServices(claims: ClaimItem[], cptDb: CPTDatabase): GhostService[] {
    const ghosts: GhostService[] = [];
    const THRESHOLD = 0.15;

    // ── Build the dominant body-area map from all claims ──
    const bodyAreas: { code: string; area: string | null; category: string }[] = [];
    for (const c of claims) {
        const cptInfo = cptDb.codes[c.cpt_code];
        const category = cptInfo?.category || 'Unknown';
        const area = getBodyArea(c.cpt_code, c.cpt_description);
        bodyAreas.push({ code: c.cpt_code, area, category });
    }

    // Count how many services target each body area
    const areaCounts: Record<string, number> = {};
    for (const ba of bodyAreas) {
        if (ba.area && !GENERIC_CATEGORIES.includes(ba.category)) {
            areaCounts[ba.area] = (areaCounts[ba.area] || 0) + 1;
        }
    }

    // Find the dominant area (most services target it)
    const sortedAreas = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
    const dominantArea = sortedAreas[0]?.[0] || null;

    for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        const cptInfo = cptDb.codes[claim.cpt_code];
        const category = cptInfo?.category || 'Unknown';

        // ── Path A: Clinical notes exist — traditional semantic matching ──
        if (claim.recorded_clinical_notes && claim.recorded_clinical_notes.trim().length > 0) {
            const score = calculateSimilarity(claim.cpt_description, claim.recorded_clinical_notes);

            if (score < THRESHOLD) {
                ghosts.push({
                    claim_id: claim.claim_id,
                    cpt_code: claim.cpt_code,
                    cpt_description: claim.cpt_description,
                    billed_amount: claim.billed_amount_inr,
                    similarity_score: score,
                    explanation: score === 0
                        ? `PHANTOM BILLING: No clinical evidence found for "${claim.cpt_description}" (₹${claim.billed_amount_inr.toLocaleString()}). Clinical notes explicitly state no such service was performed or required. This charge appears to be phantom billing.`
                        : `INSUFFICIENT EVIDENCE: Minimal clinical support (${(score * 100).toFixed(0)}% match) for "${claim.cpt_description}" (₹${claim.billed_amount_inr.toLocaleString()}). Expected keywords related to ${category} were not found in documentation.`,
                });
            }
            continue;
        }

        // ── Path B: No notes — body-area analysis ──
        // Skip generic categories (E&M, Supplies, etc.) — they're area-agnostic
        if (GENERIC_CATEGORIES.includes(category)) continue;

        const thisArea = bodyAreas[i].area;
        if (!thisArea) continue; // Can't determine area, skip

        // If this service targets a different body area than the dominant one,
        // AND the dominant area has at least 1 service, flag it
        if (dominantArea && thisArea !== dominantArea) {
            // Check: does ANY other non-generic service share this area?
            const hasRelatedService = bodyAreas.some((ba, idx) =>
                idx !== i && ba.area === thisArea && !GENERIC_CATEGORIES.includes(ba.category)
            );

            if (!hasRelatedService) {
                ghosts.push({
                    claim_id: claim.claim_id,
                    cpt_code: claim.cpt_code,
                    cpt_description: claim.cpt_description,
                    billed_amount: claim.billed_amount_inr,
                    similarity_score: 0.0,
                    explanation: `PHANTOM BILLING: "${claim.cpt_description}" (₹${claim.billed_amount_inr.toLocaleString()}) targets the ${thisArea} area, but all other clinical services target ${dominantArea}. No related services or clinical documentation support this ${thisArea} procedure. This charge appears to be phantom billing — an unrelated service added to the bill.`,
                });
            }
        }
    }

    return ghosts;
}

/**
 * Detect unbundling — procedures billed separately that should be a single bundle
 */
function detectUnbundling(claims: ClaimItem[], cptDb: CPTDatabase): UnbundlingAlert[] {
    const alerts: UnbundlingAlert[] = [];
    const billedCodes = new Set(claims.map(c => c.cpt_code));

    for (const bundle of cptDb.ncci_bundles) {
        // Check if primary code and any bundled code are both present
        const hasPrimary = billedCodes.has(bundle.primary_code);
        const presentBundled = bundle.bundled_codes.filter(c => billedCodes.has(c));

        if (hasPrimary && presentBundled.length > 0) {
            const involvedCodes = [bundle.primary_code, ...presentBundled];
            const involvedClaims = claims.filter(c => involvedCodes.includes(c.cpt_code));
            const totalBilled = involvedClaims.reduce((sum, c) => sum + c.billed_amount_inr, 0);
            const correctCostInfo = cptDb.codes[bundle.correct_single_code];
            const correctCost = correctCostInfo?.avg_cost_inr || totalBilled * 0.6;

            alerts.push({
                involved_claims: involvedClaims.map(c => c.claim_id),
                involved_codes: involvedCodes,
                involved_descriptions: involvedClaims.map(c => c.cpt_description),
                total_billed: totalBilled,
                correct_code: bundle.correct_single_code,
                correct_description: bundle.correct_description,
                correct_cost: correctCost,
                potential_savings: totalBilled - correctCost,
                explanation: `UNBUNDLING DETECTED: ${involvedCodes.length} codes (${involvedCodes.join(', ')}) were billed separately for ₹${totalBilled.toLocaleString()}, but ${bundle.bundle_description}. Correct billing: "${bundle.correct_description}" (${bundle.correct_single_code}) at ₹${correctCost.toLocaleString()}. Potential overbilling: ₹${(totalBilled - correctCost).toLocaleString()}.`,
            });
        }
    }

    return alerts;
}

/**
 * Run the Ghost & Unbundling Hunter on a set of claims
 */
export function runGhostUnbundleHunter(claims: ClaimItem[], cptDb: CPTDatabase): GhostUnbundleResult {
    const ghostServices = detectGhostServices(claims, cptDb);
    const unbundlingAlerts = detectUnbundling(claims, cptDb);

    const ghostSavings = ghostServices.reduce((sum, g) => sum + g.billed_amount, 0);
    const unbundleSavings = unbundlingAlerts.reduce((sum, u) => sum + u.potential_savings, 0);
    const totalSavings = ghostSavings + unbundleSavings;

    const flaggedCount = ghostServices.length + unbundlingAlerts.length;
    let riskLevel: GhostUnbundleResult['risk_level'] = 'LOW';
    if (flaggedCount >= 3) riskLevel = 'CRITICAL';
    else if (flaggedCount >= 2) riskLevel = 'HIGH';
    else if (flaggedCount >= 1) riskLevel = 'MEDIUM';

    return {
        ghost_services: ghostServices,
        unbundling_alerts: unbundlingAlerts,
        total_potential_savings: totalSavings,
        flagged_count: flaggedCount,
        risk_level: riskLevel,
    };
}
