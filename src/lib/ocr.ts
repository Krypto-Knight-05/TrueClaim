// ============================================================
// OCR utility — Tesseract.js v7 worker API for line bounding boxes
// ============================================================

import { createWorker } from 'tesseract.js';
import { getMegaLLMCompletion } from './megallm';

export interface OCRLine {
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
}

export interface OCRResult {
    lines: OCRLine[];
    imageWidth: number;
    imageHeight: number;
}

// ── Module-level cache: persists across component unmounts / tab switches ──
const _ocrCache = new Map<string, OCRResult>();

/**
 * Generate a stable cache key from an image URL.
 * For data URLs, use a hash of the first 200 chars to keep it short.
 */
function cacheKey(imageUrl: string): string {
    if (imageUrl.startsWith('data:')) {
        // Use a simple hash of the data URL
        let h = 0;
        const sample = imageUrl.substring(0, 300);
        for (let i = 0; i < sample.length; i++) {
            h = ((h << 5) - h + sample.charCodeAt(i)) | 0;
        }
        return `data-${h}-${imageUrl.length}`;
    }
    return imageUrl;
}

/**
 * Run OCR on an image URL and return line-level bounding boxes.
 * Uses Tesseract.js v7 worker API with `blocks: true` output to get bbox data.
 * Results are cached at module level so re-visiting a tab doesn't re-scan.
 */
export async function recognizeLines(imageUrl: string): Promise<OCRResult> {
    const key = cacheKey(imageUrl);
    if (_ocrCache.has(key)) {
        return _ocrCache.get(key)!;
    }

    const worker = await createWorker('eng');

    // Request blocks output to get bounding box hierarchy
    const result = await worker.recognize(imageUrl, {}, { blocks: true });
    await worker.terminate();

    const lines: OCRLine[] = [];
    const data = result.data as unknown as Record<string, unknown>;

    // v7 with blocks:true returns data.blocks[] > paragraphs[] > lines[]
    const blocks = (data.blocks || []) as Array<{
        paragraphs?: Array<{
            lines?: Array<{
                text: string;
                confidence: number;
                bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
        }>;
        bbox?: { x0: number; y0: number; x1: number; y1: number };
    }>;

    let maxX = 800;
    let maxY = 600;

    for (const block of blocks) {
        if (block.bbox) {
            maxX = Math.max(maxX, block.bbox.x1);
            maxY = Math.max(maxY, block.bbox.y1);
        }
        for (const paragraph of block.paragraphs || []) {
            for (const line of paragraph.lines || []) {
                const text = (line.text || '').trim();
                if (text.length < 2) continue;
                lines.push({
                    text,
                    bbox: line.bbox,
                    confidence: line.confidence ?? 50,
                });
            }
        }
    }

    const ocrResult: OCRResult = { lines, imageWidth: maxX, imageHeight: maxY };
    _ocrCache.set(key, ocrResult);
    return ocrResult;
}

/**
 * Match keywords against OCR lines. Case-insensitive substring matching.
 * Returns lines where ANY keyword appears, but filters out generic headers.
 */
export function matchKeywordsToLines(
    ocrLines: OCRLine[],
    keywords: string[]
): OCRLine[] {
    if (keywords.length === 0 || ocrLines.length === 0) return [];

    const lowerKws = keywords.map(k => k.toLowerCase().trim()).filter(k => k.length >= 2);
    if (lowerKws.length === 0) return [];

    // Header keywords that should typically be ignored for evidence highlighting
    const HEADER_KEYWORDS = new Set(['triage', 'department', 'hospital', 'summary', 'patient', 'name', 'date', 'radiology', 'imaging', 'findings', 'discharge', 'emergency', 'clinics', 'speciality']);

    const matched: OCRLine[] = [];
    const seen = new Set<number>();

    for (let li = 0; li < ocrLines.length; li++) {
        const text = ocrLines[li].text.trim();
        const lineLower = text.toLowerCase();

        // Skip header lines (unless it's an exact match for a very specific keyword, which is rare)
        const words = lineLower.split(/[\s,;:|]+/).filter(w => w.length > 0);
        const isHeader = words.length <= 4 && words.some(w => HEADER_KEYWORDS.has(w));

        // Also skip very short lines that might be noise
        if (text.length < 3) continue;

        for (const kw of lowerKws) {
            if (lineLower.includes(kw) && !seen.has(li)) {
                // If it's a header line, only include if the keyword is NOT one of the header keywords
                // or if it's a very specific medical term
                if (isHeader && HEADER_KEYWORDS.has(kw)) continue;

                matched.push(ocrLines[li]);
                seen.add(li);
                break;
            }
        }
    }

    return matched;
}

/**
 * Use MegaLLM to find lines that are semantically related to keywords.
 * Helpful for recognizing "Shortness of breath" when searching for "Dyspnea".
 */
export async function matchKeywordsSemantically(
    ocrLines: OCRLine[],
    keywords: string[]
): Promise<OCRLine[]> {
    if (keywords.length === 0 || ocrLines.length === 0) return [];

    const sampleLines = ocrLines.map(l => l.text).slice(0, 50).join('\n');
    const prompt = `
        Below are lines from a medical document OCR scan.
        Identify which lines semantically match these medical search terms: ${keywords.join(', ')}.

        Lines:
        ${sampleLines}

        Return ONLY the exact text of matching lines, one per line. No explanation.
    `;

    const response = await getMegaLLMCompletion([
        { role: 'system', content: 'You are a medical document analyst. Return only the exact matching text from the lines provided.' },
        { role: 'user', content: prompt }
    ]);

    if (!response) return [];

    const matchedTexts: string[] = response.split('\n').map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 3);
    return ocrLines.filter(l =>
        matchedTexts.some((mt: string) => l.text.toLowerCase().includes(mt) || mt.includes(l.text.toLowerCase()))
    );
}

/**
 * Extract search keywords from annotation labels and details.
 * Aggressive extraction — pulls individual meaningful words too.
 */
export function extractKeywords(
    annotations: { label: string; detail: string; type: string }[]
): string[] {
    const keywords = new Set<string>();

    // Common English stop words to skip
    const stopWords = new Set([
        'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
        'had', 'her', 'was', 'one', 'our', 'out', 'has', 'him', 'how',
        'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who', 'did',
        'get', 'let', 'say', 'she', 'too', 'use', 'this', 'that', 'with',
        'have', 'from', 'they', 'been', 'said', 'each', 'which', 'their',
        'will', 'other', 'about', 'there', 'than', 'into', 'them', 'these',
        'some', 'could', 'would', 'make', 'like', 'just', 'over', 'such',
        'take', 'also', 'back', 'after', 'only', 'come', 'made', 'find',
        'here', 'thing', 'many', 'well', 'between', 'does', 'during',
        'same', 'both', 'being', 'under', 'while', 'indicates', 'billed',
        'severity', 'evidence', 'code', 'claim', 'claims', 'level',
        'gap', 'total', 'missing', 'detected', 'found', 'procedure',
        'should', 'bundled', 'separately', 'single',
    ]);

    for (const ann of annotations) {
        const combined = `${ann.label} ${ann.detail}`;

        // Extract CPT codes (like 49320, 99213)
        const cptCodes = combined.match(/\b\d{5}\b/g);
        cptCodes?.forEach(c => keywords.add(c));

        // Extract time patterns
        const times = combined.match(/\d{1,2}:\d{2}/g);
        times?.forEach(t => keywords.add(t));

        // Extract words from procedure descriptions and labels
        // Split on common separators
        const words = combined.split(/[\s,;:—–\-•|\/\(\)]+/);
        for (const word of words) {
            const clean = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (clean.length >= 4 && !stopWords.has(clean) && !/^\d+$/.test(clean)) {
                keywords.add(clean);
            }
        }

        // Also extract multi-word phrases that look like procedure names
        const phrases = combined.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g);
        phrases?.forEach(p => {
            if (p.length > 5) keywords.add(p.toLowerCase());
        });

        // Department / hospital names
        const depts = combined.match(/(?:Fortis|Apollo|Max|AIIMS|Medanta|Hospital|Clinic)\s*\w*/gi);
        depts?.forEach(d => keywords.add(d.toLowerCase().trim()));
    }

    return Array.from(keywords).filter(k => k.length >= 3);
}
