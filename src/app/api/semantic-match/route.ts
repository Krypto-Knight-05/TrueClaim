import { NextRequest, NextResponse } from 'next/server';
import { getMegaLLMCompletion } from '@/lib/megallm';

export async function POST(request: NextRequest) {
    try {
        const { ocrLines, keywords } = await request.json();

        if (!ocrLines || !keywords || !Array.isArray(ocrLines) || !Array.isArray(keywords)) {
            return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
        }

        const sampleLines = ocrLines.map((l: any) => l.text).slice(0, 50).join('\n');
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

        if (!response) {
            return NextResponse.json({ matchedLines: [] });
        }

        const matchedTexts = response.split('\n').map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 3);
        const filteredLines = ocrLines.filter((l: any) =>
            matchedTexts.some((mt: string) => l.text.toLowerCase().includes(mt) || mt.includes(l.text.toLowerCase()))
        );

        return NextResponse.json({ matchedLines: filteredLines });
    } catch (error) {
        console.error('[API Semantic Match] error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
