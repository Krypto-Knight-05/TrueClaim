// ============================================================
// Feature 4: Transparent Advisor — XAI Engine
// Generates explainable risk scores and human-readable narratives
// ============================================================

import {
    CrossModalResult,
    TimelineResult,
    GhostUnbundleResult,
    XAIResult,
    RiskFactor,
    ClaimItem,
    CPTDatabase,
} from '../types';
import { generateMegaLLMBrief } from '@/lib/megallm';

/**
 * Calculate individual risk factors from all feature results
 */
function calculateFactors(
    crossModal: CrossModalResult,
    timeline: TimelineResult,
    ghostUnbundle: GhostUnbundleResult,
    claims: ClaimItem[],
    cptDb: CPTDatabase
): RiskFactor[] {
    const factors: RiskFactor[] = [];
    const totalBilled = claims.reduce((sum, c) => sum + c.billed_amount_inr, 0);
    const avgExpected = claims.reduce((sum, c) => {
        const info = cptDb.codes[c.cpt_code];
        return sum + (info?.avg_cost_inr || 0);
    }, 0);

    // Factor 1: Severity Mismatch (Cross-Modal)
    if (crossModal.mismatches.length > 0) {
        const maxGap = Math.max(...crossModal.mismatches.map(m => m.severity_gap));
        const contribution = Math.min(maxGap * 0.12, 0.35);
        factors.push({
            name: 'Severity Mismatch',
            contribution,
            description: `${crossModal.mismatches.length} billing code(s) don't match clinical note severity. Max gap: Level ${maxGap}.`,
            direction: 'RISK',
        });
    } else {
        factors.push({
            name: 'Severity Match',
            contribution: -0.08,
            description: 'All billing codes match clinical note severity levels.',
            direction: 'SAFE',
        });
    }

    // Factor 2: Timeline Anomalies
    if (timeline.overlaps.length > 0) {
        const hasTeleportation = timeline.overlaps.some(o => o.type === 'TELEPORTATION');
        const contribution = hasTeleportation ? 0.30 : timeline.overlaps.length * 0.10;
        factors.push({
            name: hasTeleportation ? 'Impossible Travel' : 'Time Overlaps',
            contribution: Math.min(contribution, 0.35),
            description: hasTeleportation
                ? `Patient billed at physically distant locations simultaneously. ${timeline.overlaps.length} impossible event(s) detected.`
                : `${timeline.overlaps.length} overlapping procedure(s) detected in timeline.`,
            direction: 'RISK',
        });
    } else {
        factors.push({
            name: 'Timeline Clean',
            contribution: -0.05,
            description: 'No overlapping procedures or impossible travel detected.',
            direction: 'SAFE',
        });
    }

    // Factor 3: Ghost Services
    if (ghostUnbundle.ghost_services.length > 0) {
        const ghostAmount = ghostUnbundle.ghost_services.reduce((s, g) => s + g.billed_amount, 0);
        const contribution = Math.min(0.10 + (ghostAmount / totalBilled) * 0.3, 0.30);
        factors.push({
            name: 'Phantom Charges',
            contribution,
            description: `${ghostUnbundle.ghost_services.length} service(s) billed with zero clinical evidence. Total: ₹${ghostAmount.toLocaleString()}.`,
            direction: 'RISK',
        });
    }

    // Factor 4: Unbundling
    if (ghostUnbundle.unbundling_alerts.length > 0) {
        const savings = ghostUnbundle.total_potential_savings;
        const contribution = Math.min(0.08 + (savings / totalBilled) * 0.2, 0.25);
        factors.push({
            name: 'Code Unbundling',
            contribution,
            description: `${ghostUnbundle.unbundling_alerts.length} unbundling violation(s). Potential overbilling: ₹${savings.toLocaleString()}.`,
            direction: 'RISK',
        });
    }

    // Factor 5: Cost Anomaly
    if (avgExpected > 0) {
        const costRatio = totalBilled / avgExpected;
        if (costRatio > 1.5) {
            factors.push({
                name: 'Excessive Billing',
                contribution: Math.min((costRatio - 1) * 0.1, 0.20),
                description: `Total billed ₹${totalBilled.toLocaleString()} is ${((costRatio - 1) * 100).toFixed(0)}% above regional average of ₹${avgExpected.toLocaleString()}.`,
                direction: 'RISK',
            });
        } else {
            factors.push({
                name: 'Cost Normal',
                contribution: -0.05,
                description: `Total billed ₹${totalBilled.toLocaleString()} is within expected range.`,
                direction: 'SAFE',
            });
        }
    }

    // Factor 6: Documentation Quality
    const missingDocs = claims.filter(c =>
        c.recorded_clinical_notes.toLowerCase().includes('no record') ||
        c.recorded_clinical_notes.length < 20
    ).length;

    if (missingDocs > 0) {
        factors.push({
            name: 'Poor Documentation',
            contribution: missingDocs * 0.08,
            description: `${missingDocs} claim(s) have missing or insufficient clinical documentation.`,
            direction: 'RISK',
        });
    } else {
        factors.push({
            name: 'Documentation Complete',
            contribution: -0.05,
            description: 'All claims have accompanying clinical notes.',
            direction: 'SAFE',
        });
    }

    return factors;
}

/**
 * Generate a professional narrative explanation
 */
function generateNarrative(
    factors: RiskFactor[],
    riskScore: number,
    claims: ClaimItem[],
    totalBilled: number
): string {
    const riskFactors = factors.filter(f => f.direction === 'RISK');
    const safeFactors = factors.filter(f => f.direction === 'SAFE');
    const patientName = claims[0]?.patient_name || 'Unknown Patient';
    const claimCount = claims.length;

    let narrative = `## Audit Brief: ${patientName}\n\n`;

    // Executive summary paragraph
    if (riskScore >= 75) {
        narrative += `This is a **high-concern claim package** — ${claimCount} submitted procedures totaling ₹${totalBilled.toLocaleString()} have triggered multiple audit flags across severity, timeline, and billing pattern checks. The combination of findings warrants careful review before any payment is processed.\n\n`;
    } else if (riskScore >= 50) {
        narrative += `This claim package — ${claimCount} procedures totaling ₹${totalBilled.toLocaleString()} — contains several indicators that do not align with standard billing patterns. While individual discrepancies may have explanations, their collective presence elevates the integrity risk significantly.\n\n`;
    } else if (riskScore >= 25) {
        narrative += `This claim package of ${claimCount} procedures (₹${totalBilled.toLocaleString()} total) is largely within expected parameters, but a few items require clarification before approval. The concerns noted below are moderate and may reflect data entry issues or documentation gaps rather than deliberate fraud.\n\n`;
    } else {
        narrative += `This claim package — ${claimCount} procedures totaling ₹${totalBilled.toLocaleString()} — presents a clean audit profile. All major checks related to billing severity, procedural timelines, and documentation coverage have passed without material concern.\n\n`;
    }

    if (riskFactors.length > 0) {
        narrative += `### Audit Concerns\n\n`;
        const sorted = [...riskFactors].sort((a, b) => b.contribution - a.contribution);
        sorted.forEach((f) => {
            narrative += `**${f.name}** — ${f.description}\n\n`;
        });
    }

    if (safeFactors.length > 0) {
        narrative += `### Factors in the Claim's Favour\n\n`;
        safeFactors.forEach((f) => {
            narrative += `**${f.name}** — ${f.description}\n\n`;
        });
    }

    narrative += `### Analyst Recommendation\n\n`;
    if (riskScore >= 75) {
        narrative += `Given the severity and scope of the flagged items, this claim should be **placed on hold and referred for a detailed audit** before any disbursement. The auditor should request supporting documentation from the provider for every flagged line item, with particular focus on the concerns listed above. This is an advisory recommendation only — final authority rests with the designated claims officer.`;
    } else if (riskScore >= 50) {
        narrative += `This claim should be **held for provider clarification**. Contact the billing provider to request documentation supporting the flagged procedures. If satisfactory documentation is received and the discrepancies can be explained, conditional approval may be considered. Do not process payment without additional verification.`;
    } else if (riskScore >= 25) {
        narrative += `This claim may be **approved with a note for follow-up**. The minor discrepancies identified do not constitute strong grounds for rejection, but should be logged in the provider's compliance record for pattern monitoring. Routine payment processing can proceed.`;
    } else {
        narrative += `This claim is **recommended for approval**. No material anomalies were detected across any of the four audit engines. The claim aligns with expected billing norms, clinical documentation, and procedural timelines.`;
    }

    narrative += `\n\n> *This analysis is generated by the TrueClaim audit engine and is intended to assist — not replace — human review. All flagged items require verification before any enforcement or legal action is taken.*`;

    return narrative;
}

/**
 * Run the XAI Advisor on combined analysis results
 */
export async function runXAIAdvisor(
    crossModal: CrossModalResult,
    timeline: TimelineResult,
    ghostUnbundle: GhostUnbundleResult,
    claims: ClaimItem[],
    cptDb: CPTDatabase
): Promise<XAIResult> {
    const totalBilled = claims.reduce((sum, c) => sum + c.billed_amount_inr, 0);
    const factors = calculateFactors(crossModal, timeline, ghostUnbundle, claims, cptDb);

    // Calculate risk score from factors
    const baseScore = 10; // Baseline risk
    const riskContribution = factors
        .filter(f => f.direction === 'RISK')
        .reduce((sum, f) => sum + f.contribution, 0);
    const safeContribution = factors
        .filter(f => f.direction === 'SAFE')
        .reduce((sum, f) => sum + Math.abs(f.contribution), 0);

    const rawScore = baseScore + riskContribution * 100 - safeContribution * 15;
    const riskScore = Math.round(Math.max(0, Math.min(100, rawScore)));

    let riskLevel: XAIResult['risk_level'] = 'LOW';
    let recommendation: XAIResult['recommendation'] = 'APPROVE';

    if (riskScore >= 75) {
        riskLevel = 'CRITICAL';
        recommendation = 'REJECT';
    } else if (riskScore >= 50) {
        riskLevel = 'HIGH';
        recommendation = 'ESCALATE';
    } else if (riskScore >= 25) {
        riskLevel = 'MEDIUM';
        recommendation = 'REVIEW';
    }

    const localNarrative = generateNarrative(factors, riskScore, claims, totalBilled);

    // MegaLLM Integration: Attempt to generate a professional brief
    const llmBrief = await generateMegaLLMBrief({
        patient_name: claims[0]?.patient_name || 'Unknown',
        total_billed: totalBilled,
        total_claims: claims.length,
        xai: { risk_score: riskScore, factors, financial_summary: { potential_savings: ghostUnbundle.total_potential_savings } }
    });

    const narrative = llmBrief || localNarrative;

    const potentialSavings = ghostUnbundle.total_potential_savings; // Current implementation only tracks ghost/unbundle savings

    return {
        risk_score: riskScore,
        risk_level: riskLevel,
        factors,
        narrative,
        recommendation,
        financial_summary: {
            billed_amount: totalBilled,
            expected_amount: totalBilled - potentialSavings,
            potential_savings: potentialSavings,
        },
    };
}
