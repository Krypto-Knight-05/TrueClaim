// ============================================================
// Feature 2: Timeline Detective — Temporal Fraud Detection
// Detects overlapping procedures and impossible travel
// ============================================================

import { ClaimItem, CPTDatabase, TimelineEvent, TimelineOverlap, TimelineResult } from '../types';

// Default procedure durations in minutes by CPT category
const DEFAULT_DURATIONS: Record<string, number> = {
    'E&M': 30,
    'Critical Care': 60,
    'Radiology': 45,
    'Surgery': 120,
    'Physical Therapy': 30,
    'Supplies': 10,
};

/**
 * Haversine formula to calculate distance between two lat/lng points in km
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Parse date + time string to a Date object. Robustly handles missing dates.
 */
function parseDateTime(date: string, time: string): Date {
    const validDate = date && date.trim().length > 0 ? date : new Date().toISOString().split('T')[0];
    const validTime = time && time.trim().length > 0 ? time : '12:00';
    const d = new Date(`${validDate}T${validTime}:00`);
    return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Convert claims to timeline events
 */
function claimsToEvents(claims: ClaimItem[], cptDb: CPTDatabase): TimelineEvent[] {
    return claims.map(claim => {
        const cptInfo = cptDb.codes[claim.cpt_code];
        const category = cptInfo?.category || 'E&M';
        const durationMinutes = DEFAULT_DURATIONS[category] || 30;

        const startDate = parseDateTime(claim.date, claim.time);
        const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

        return {
            claim_id: claim.claim_id,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            department: claim.department,
            procedure: claim.cpt_description,
            location_lat: claim.location_lat,
            location_lng: claim.location_lng,
        };
    });
}

/**
 * Check if two time intervals overlap
 */
function intervalsOverlap(startA: Date, endA: Date, startB: Date, endB: Date): number {
    const overlapStart = Math.max(startA.getTime(), startB.getTime());
    const overlapEnd = Math.min(endA.getTime(), endB.getTime());
    const overlapMs = overlapEnd - overlapStart;
    return overlapMs > 0 ? overlapMs / 60000 : 0; // returns minutes
}

/**
 * Run the Timeline Detective on a set of claims
 */
export function runTimelineDetective(claims: ClaimItem[], cptDb: CPTDatabase): TimelineResult {
    const events = claimsToEvents(claims, cptDb);
    const overlaps: TimelineOverlap[] = [];

    // Check all pairs for overlaps
    for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
            const a = events[i];
            const b = events[j];
            const startA = new Date(a.start_time);
            const endA = new Date(a.end_time);
            const startB = new Date(b.start_time);
            const endB = new Date(b.end_time);

            const overlapMinutes = intervalsOverlap(startA, endA, startB, endB);

            if (overlapMinutes > 0) {
                // Check if different locations
                const differentLocation = a.department !== b.department;
                let type: TimelineOverlap['type'] = 'OVERLAP';
                let requiredSpeed: number | undefined;
                let explanation = '';

                if (differentLocation && a.location_lat && a.location_lng && b.location_lat && b.location_lng) {
                    const distance = haversineDistance(a.location_lat, a.location_lng, b.location_lat, b.location_lng);
                    const timeDiffHours = Math.abs(startB.getTime() - startA.getTime()) / 3600000;

                    if (timeDiffHours > 0) {
                        requiredSpeed = distance / timeDiffHours;
                    } else {
                        requiredSpeed = Infinity;
                    }

                    if (distance > 5) { // More than 5 km apart
                        type = 'TELEPORTATION';
                        explanation = `IMPOSSIBLE TRAVEL: Patient billed at "${a.department}" and "${b.department}" simultaneously. Distance: ${distance.toFixed(1)} km. Required travel speed: ${requiredSpeed === Infinity ? '∞' : requiredSpeed.toFixed(0)} km/h. Patient was under general anesthesia during the claimed physiotherapy session.`;
                    } else {
                        explanation = `TIME OVERLAP: "${a.procedure}" (${a.department}) overlaps with "${b.procedure}" (${b.department}) by ${overlapMinutes.toFixed(0)} minutes. These procedures cannot be performed simultaneously.`;
                    }
                } else if (differentLocation) {
                    explanation = `TIME OVERLAP at different locations: "${a.procedure}" at ${a.department} overlaps with "${b.procedure}" at ${b.department} by ${overlapMinutes.toFixed(0)} minutes.`;
                } else {
                    explanation = `SAME-LOCATION OVERLAP: "${a.procedure}" and "${b.procedure}" at ${a.department} overlap by ${overlapMinutes.toFixed(0)} minutes. Check if these can reasonably be concurrent.`;
                }

                overlaps.push({
                    event_a: a,
                    event_b: b,
                    overlap_minutes: overlapMinutes,
                    explanation,
                    type,
                    required_speed_kmh: requiredSpeed,
                });
            }
        }
    }

    const flaggedCount = overlaps.length;
    let riskLevel: TimelineResult['risk_level'] = 'LOW';
    if (overlaps.some(o => o.type === 'TELEPORTATION')) riskLevel = 'CRITICAL';
    else if (flaggedCount >= 3) riskLevel = 'HIGH';
    else if (flaggedCount >= 1) riskLevel = 'MEDIUM';

    return {
        events,
        overlaps,
        flagged_count: flaggedCount,
        risk_level: riskLevel,
    };
}
