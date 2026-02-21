import { NextRequest, NextResponse } from 'next/server';
import { getMegaLLMCompletion, ChatMessage } from '@/lib/megallm';

export async function POST(request: NextRequest) {
    try {
        const { messages } = await request.json();
        console.log(`[API Chat] Received request with ${messages?.length || 0} messages`);
        console.log('[API Chat] Key available:', !!process.env.GEMINI_API_KEY);

        if (!messages || !Array.isArray(messages)) {
            return NextResponse.json({ error: 'Invalid messages format' }, { status: 400 });
        }

        const response = await getMegaLLMCompletion(messages as ChatMessage[]);
        console.log('[API Chat] getMegaLLMCompletion returned:', response ? 'SUCCESS' : 'NULL');

        if (!response) {
            return NextResponse.json({
                response: 'The AI service is currently unavailable. The MegaLLM API key may need to be configured or the service may be temporarily down. Your audit data is still accessible in the report above.'
            });
        }

        return NextResponse.json({ response });
    } catch (error) {
        console.error('[API Chat] error:', error);
        return NextResponse.json({
            response: 'An unexpected error occurred while processing your request. Please try again.'
        });
    }
}
