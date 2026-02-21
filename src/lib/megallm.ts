import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * AI Utility for TrueClaim
 * Powered by Google Gemini.
 * Handles communication with the Generative AI SDK securely on the server.
 */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Basic completion helper using Gemini
 * Maintains the 'MegaLLM' naming convention to avoid breaking existing imports.
 */
export async function getMegaLLMCompletion(messages: ChatMessage[], model: string = 'gemini-1.5-flash') {
    const apiKey = process.env.GEMINI_API_KEY;

    if (typeof window !== 'undefined') {
        throw new Error('[Gemini] Security Violation: getMegaLLMCompletion called from client-side code.');
    }

    if (!apiKey) {
        console.error('[Gemini] API key missing in process.env.GEMINI_API_KEY');
        console.log('[Gemini] Current environment keys:', Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('API')));
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const actualModel = 'gemini-flash-latest';

        const systemInstruction = messages.find(m => m.role === 'system')?.content;
        const modelInstance = genAI.getGenerativeModel({
            model: actualModel,
            systemInstruction: systemInstruction || undefined
        });

        const chatMessages = messages.filter(m => m.role !== 'system');
        const history = chatMessages.slice(0, -1).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
        }));

        const lastMessage = chatMessages[chatMessages.length - 1]?.content || '';

        console.log(`[Gemini] Requesting: ${actualModel} | History length: ${history.length} | Prompt: ${lastMessage.substring(0, 50)}...`);

        const result = await modelInstance.generateContent({
            contents: [...history, { role: 'user', parts: [{ text: lastMessage }] }],
            generationConfig: {
                temperature: 0.7,
            },
        });

        const response = await result.response;
        const text = response.text();

        console.log('[Gemini] Response received successfully');
        return text;
    } catch (error: any) {
        console.error('[Gemini] Generation error:', error.message || error);
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
