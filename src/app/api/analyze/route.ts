// ============================================================
// API Route: /api/analyze
// POST: Accepts claim data, returns full analysis
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { analyzeFullClaim } from '@/lib/engine/analyzer';
import { ClaimItem, CPTDatabase } from '@/lib/types';
import cptData from '../../../../public/data/cpt_codes.json';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const rawClaims = body.claims;

        if (!rawClaims || !Array.isArray(rawClaims) || rawClaims.length === 0) {
            return NextResponse.json(
                { error: 'Invalid request: "claims" array is required' },
                { status: 400 }
            );
        }

        // Coerce every claim into a valid ClaimItem (handle missing fields gracefully)
        const claims: ClaimItem[] = rawClaims.map((c: Record<string, unknown>, i: number) => ({
            claim_id: String(c.claim_id || `CLM-${i + 1}`),
            patient_name: String(c.patient_name || 'Unknown'),
            date: String(c.date || ''),
            time: String(c.time || '12:00'),
            department: String(c.department || ''),
            cpt_code: String(c.cpt_code || ''),
            cpt_description: String(c.cpt_description || ''),
            billed_amount_inr: Number(c.billed_amount_inr) || 0,
            recorded_clinical_notes: String(c.recorded_clinical_notes || ''),
            location_lat: c.location_lat != null ? Number(c.location_lat) : undefined,
            location_lng: c.location_lng != null ? Number(c.location_lng) : undefined,
        }));

        const cptDb = cptData as unknown as CPTDatabase;
        const result = await analyzeFullClaim(claims, cptDb);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Analysis error:', error);
        return NextResponse.json(
            { error: 'Internal server error during analysis', details: String(error) },
            { status: 500 }
        );
    }
}
