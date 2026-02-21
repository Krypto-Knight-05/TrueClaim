/**
 * MegaLLM Utility for ClaimGuard AI
 * Handles communication with the MegaLLM API Gateway.
 */

const API_KEY = process.env.MEGALLM_API_KEY;
const API_URL = process.env.NEXT_PUBLIC_MEGALLM_API_URL || 'https://api.megallm.io/v1';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Basic completion helper for MegaLLM
 */
export async function getMegaLLMCompletion(messages: ChatMessage[], model: string = 'gpt-4o') {
    if (!API_KEY) {
        console.warn('[MegaLLM] API key missing. Falling back to local mock logic.');
        return null;
    }

    try {
        const response = await fetch(`${API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`MegaLLM API error: ${response.status} ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || null;
    } catch (error) {
        console.error('[MegaLLM] completion error:', error);
        return null;
    }
}

/**
 * Specialized hook-like utility for generating audit briefs
 */
export async function generateMegaLLMBrief(auditData: any): Promise<string | null> {
    const prompt = `
    You are an expert Medical Insurance Auditor. 
    Analyze the following audit findings and generate a professional, natural, and authoritative Executive Summary.
    
    PATIENT: ${auditData.patient_name}
    TOTAL BILLED: ₹${auditData.total_billed}
    TOTAL CLAIMS: ${auditData.total_claims}
    RISK SCORE: ${auditData.xai.risk_score}/100
    POTENTIAL SAVINGS: ₹${auditData.xai.financial_summary.potential_savings}
    
    FACTORS:
    ${auditData.xai.factors.map((f: any) => `- ${f.name}: ${f.description}`).join('\n')}
    
    GUIDELINES:
    1. Do not use generic templates. Write like a human analyst.
    2. Be firm but professional.
    3. Focus on the financial impact and medical necessity discrepancies.
    4. Use Markdown formatting (bold, bullet points).
    5. KEEP IT CONCISE. Max 3-4 paragraphs.
    
    Format the output as a professional brief.
  `;

    return getMegaLLMCompletion([
        { role: 'system', content: 'You are a professional medical insurance audit analyst.' },
        { role: 'user', content: prompt }
    ]);
}
