'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { FullAnalysisResult } from '@/lib/types';
import { getUploadData } from '@/lib/store';
import { recognizeLines, matchKeywordsToLines, extractKeywords, OCRLine } from '@/lib/ocr';

// ================================================================
// COMPONENTS
// ================================================================

function RiskGauge({ score, level }: { score: number; level: string }) {
    const [animatedScore, setAnimatedScore] = useState(0);
    useEffect(() => { const t = setTimeout(() => setAnimatedScore(score), 300); return () => clearTimeout(t); }, [score]);
    const colorClass = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    // Needle angle: 0% → -180° (far left), 100% → 0° (far right), measured from +x axis
    // For SVG where y-down is positive, we negate sin so the needle sweeps upward
    const angleRad = ((animatedScore / 100) * 180) * (Math.PI / 180); // 0..π
    const needleX = 100 + 70 * Math.cos(Math.PI - angleRad);
    const needleY = 100 - 70 * Math.sin(Math.PI - angleRad);
    return (
        <div className="risk-gauge-container">
            <div className="risk-gauge">
                <svg viewBox="0 0 200 120" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke="var(--bg-secondary)" strokeWidth="16" strokeLinecap="round" />
                    <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none"
                        stroke={score >= 75 ? '#ef4444' : score >= 50 ? '#f97316' : score >= 25 ? '#f59e0b' : '#10b981'}
                        strokeWidth="16" strokeLinecap="round"
                        strokeDasharray={`${(animatedScore / 100) * 283} 283`}
                        style={{ transition: 'stroke-dasharray 1.5s ease-out' }} />
                    <line x1="100" y1="100"
                        x2={needleX}
                        y2={needleY}
                        stroke="var(--text-primary)" strokeWidth="3" strokeLinecap="round"
                        style={{ transition: 'all 1.5s ease-out' }} />
                    <circle cx="100" cy="100" r="6" fill="var(--text-primary)" />
                </svg>
            </div>
            <div className="risk-score-display">
                <div className={`risk-score-number ${colorClass}`}>{animatedScore}</div>
                <div className="risk-score-label">{level} Risk</div>
            </div>
        </div>
    );
}

function WaterfallChart({ factors }: { factors: FullAnalysisResult['xai']['factors'] }) {
    return (
        <div className="waterfall-chart">
            {factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).map((f, i) => (
                <div className="waterfall-item" key={i} style={{ animation: `slideIn 0.4s ease-out ${i * 0.1}s both` }}>
                    <div className="waterfall-label">{f.name}</div>
                    <div className="waterfall-bar-container">
                        <div className={`waterfall-bar ${f.direction === 'RISK' ? 'risk' : 'safe'}`}
                            style={{ width: `${Math.max(Math.abs(f.contribution) * 300, 8)}px` }} />
                        <span className={`waterfall-value ${f.direction === 'RISK' ? 'risk' : 'safe'}`}>
                            {f.direction === 'RISK' ? '+' : '-'}{(Math.abs(f.contribution) * 100).toFixed(0)}%
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function FlagDistributionChart({ result }: { result: FullAnalysisResult }) {
    const categories = [
        { label: 'Upcoding', count: result.cross_modal.mismatches.filter(m => m.severity_gap > 0).length, color: '#ef4444' },
        { label: 'Downcoding', count: result.cross_modal.mismatches.filter(m => m.severity_gap < 0).length, color: '#f97316' },
        { label: 'Phantom', count: result.ghost_unbundle.ghost_services.length, color: '#06b6d4' },
        { label: 'Unbundling', count: result.ghost_unbundle.unbundling_alerts.length, color: '#8b5cf6' },
        { label: 'Timeline', count: result.timeline.flagged_count, color: '#ec4899' },
    ].filter(c => c.count > 0);

    const total = categories.reduce((s, c) => s + c.count, 0);
    if (total === 0) return null;

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let accumulated = 0;

    return (
        <div>
            <div style={{ position: 'relative', width: '180px', height: '180px', margin: '0 auto' }}>
                <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    {categories.map((cat, i) => {
                        const sliceLen = (cat.count / total) * circumference;
                        const gap = 4;
                        const dashLen = Math.max(sliceLen - gap, 2);
                        const offset = accumulated;
                        accumulated += sliceLen;
                        return (
                            <circle
                                key={i}
                                cx="100" cy="100" r={radius}
                                fill="none"
                                stroke={cat.color}
                                strokeWidth="24"
                                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                                strokeDashoffset={-offset}
                                strokeLinecap="round"
                                style={{ transition: 'stroke-dasharray 0.8s ease-out, stroke-dashoffset 0.8s ease-out' }}
                            />
                        );
                    })}
                </svg>
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)' }}>{total}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Flags</div>
                </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
                {categories.map((cat, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{cat.label} ({cat.count})</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OfficerToolkit({ result }: { result: FullAnalysisResult }) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<{ role: 'user' | 'bot', content: string }[]>([
        { role: 'bot', content: `Audit Officer Initialized. I have analyzed ${result.patient_name}'s claims. How can I assist with your investigation today?` }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsLoading(true);

        const context = `
            You are an AI Auditor for TrueClaim.
            Current Audit Status:
            - Patient: ${result.patient_name}
            - Total Billed: ₹${result.total_billed}
            - Claims: ${result.claims.map(c => `${c.cpt_code} (${c.cpt_description})`).join(', ')}
            - Major Flags: ${result.xai.factors.filter(f => f.direction === 'RISK').map(f => f.name).join(', ')}
            
            Task: Assist the Audit Officer with investigative questions about these claims, billing norms, or medical codes.
        `;

        try {
            const responseBody = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: context },
                        ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
                        { role: 'user', content: userMsg }
                    ]
                })
            });

            const data = await responseBody.json();
            setMessages(prev => [...prev, { role: 'bot', content: data.response || 'No response received. The AI service may be temporarily unavailable.' }]);
        } catch {
            setMessages(prev => [...prev, { role: 'bot', content: 'Network error — unable to reach the analysis server. Please check your connection.' }]);
        }
        setIsLoading(false);
    };

    return (
        <>
            <button className={`toolkit-trigger${isOpen ? ' open' : ''}`} onClick={() => setIsOpen(!isOpen)} aria-label="Open Investigation Toolkit">
                {isOpen ? '✕' : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                )}
            </button>

            {isOpen && (
                <div className="toolkit-window">
                    <div className="toolkit-header">
                        <div>
                            <h3>Investigation Toolkit</h3>
                            <div className="header-sub">TrueClaim AI Analyst — Live</div>
                        </div>
                        <button className="close-btn" onClick={() => setIsOpen(false)}>✕</button>
                    </div>

                    <div className="toolkit-messages" ref={scrollRef}>
                        {messages.map((m, i) => (
                            <div key={i} className={`chat-msg ${m.role}`}>
                                {m.content}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="chat-msg bot typing">
                                <span className="dot" />
                                <span className="dot" />
                                <span className="dot" />
                            </div>
                        )}
                    </div>

                    <div className="toolkit-input-area">
                        <input
                            className="toolkit-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask about codes, pricing, bundling..."
                        />
                        <button className="toolkit-send" onClick={handleSend} disabled={isLoading}>
                            ➤
                        </button>
                    </div>

                    <div className="mega-branding">
                        Intelligence by MegaLLM
                    </div>
                </div>
            )}
        </>
    );
}

// ================================================================
// Evidence Document Viewer — OCR-powered red box annotations
// ================================================================

function AnnotatedDocumentViewer({
    noteImages,
    annotations,
}: {
    noteImages: { name: string; url: string }[];
    annotations: { label: string; detail: string; type: string; color: string }[];
}) {
    const [selectedImage, setSelectedImage] = useState(0);
    const [ocrLoading, setOcrLoading] = useState(false);
    const [matchedLines, setMatchedLines] = useState<OCRLine[]>([]);
    const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    if (noteImages.length === 0) return null;

    const borderColor = annotations.length > 0
        ? annotations.find(a => a.color === '#ef4444')?.color || annotations[0].color
        : '#3b82f6';

    // Run OCR when selected image changes
    // Module-level cache in ocr.ts prevents re-scanning already-processed images
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        const url = noteImages[selectedImage]?.url;
        if (!url || annotations.length === 0) {
            setMatchedLines([]);
            return;
        }

        let cancelled = false;
        setOcrLoading(true);

        const keywords = extractKeywords(annotations);
        console.log('[ClaimGuard OCR] Keywords:', keywords);

        recognizeLines(url).then(result => {
            if (cancelled) return;
            console.log('[ClaimGuard OCR] Lines found:', result.lines.length, result.lines.map(l => l.text.substring(0, 40)));

            const matches = matchKeywordsToLines(result.lines, keywords);
            console.log('[ClaimGuard OCR] Matched lines:', matches.length);

            // Fallback: if no keyword matches found, highlight high-confidence body lines
            const finalMatches = matches.length > 0
                ? matches
                : result.lines.filter(l => l.confidence > 50 && l.text.length > 5).slice(0, 5);

            setMatchedLines(finalMatches);
            setOcrLoading(false);
        }).catch(err => {
            console.error('[ClaimGuard OCR] Error:', err);
            if (!cancelled) {
                setMatchedLines([]);
                setOcrLoading(false);
            }
        });

        return () => { cancelled = true; };
    }, [selectedImage, noteImages, annotations]);

    // Track natural image size for coordinate mapping
    const handleImageLoad = useCallback(() => {
        if (imgRef.current) {
            setImgNaturalSize({
                w: imgRef.current.naturalWidth,
                h: imgRef.current.naturalHeight,
            });
        }
    }, []);

    return (
        <div className="panel">
            <div className="panel-header">
                <h2>Clinical Evidence — Document Analysis</h2>
                <span className="status status-critical">{annotations.length} Finding(s)</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
                {/* Left: document image with OCR-positioned red boxes */}
                <div>
                    {/* Thumbnail selector */}
                    {noteImages.length > 1 && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                            {noteImages.map((img, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedImage(i)}
                                    style={{
                                        background: i === selectedImage ? 'var(--bg-card-hover)' : 'var(--bg-secondary)',
                                        border: `2px solid ${i === selectedImage ? borderColor : 'var(--border-subtle)'}`,
                                        borderRadius: '8px',
                                        padding: '3px',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                    }}
                                >
                                    <img src={img.url} alt={img.name}
                                        style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px' }} />
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Document image with red bounding boxes */}
                    <div style={{
                        borderRadius: '12px',
                        overflow: 'hidden',
                        border: `3px solid ${borderColor}`,
                        boxShadow: `0 0 20px ${borderColor}30`,
                        position: 'relative',
                    }}>
                        <img
                            ref={imgRef}
                            src={noteImages[selectedImage]?.url}
                            alt="Clinical document"
                            style={{ width: '100%', display: 'block' }}
                            onLoad={handleImageLoad}
                        />

                        {/* OCR loading shimmer */}
                        {ocrLoading && (
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(90deg, transparent 0%, rgba(239,68,68,0.08) 50%, transparent 100%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s infinite',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <span style={{
                                    background: 'rgba(0,0,0,0.7)',
                                    color: '#fff',
                                    padding: '6px 16px',
                                    borderRadius: '8px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    letterSpacing: '0.5px',
                                }}>Scanning document...</span>
                            </div>
                        )}

                        {/* Precise red bounding boxes from OCR */}
                        {!ocrLoading && imgNaturalSize && matchedLines.map((line, i) => {
                            const scaleX = 100 / imgNaturalSize.w;
                            const scaleY = 100 / imgNaturalSize.h;
                            return (
                                <div
                                    key={i}
                                    style={{
                                        position: 'absolute',
                                        left: `${line.bbox.x0 * scaleX}%`,
                                        top: `${line.bbox.y0 * scaleY}%`,
                                        width: `${(line.bbox.x1 - line.bbox.x0) * scaleX}%`,
                                        height: `${(line.bbox.y1 - line.bbox.y0) * scaleY}%`,
                                        border: `2px solid ${borderColor}`,
                                        borderRadius: '3px',
                                        background: `${borderColor}12`,
                                        pointerEvents: 'none',
                                        animation: `fadeInUp 0.3s ease-out ${0.1 + i * 0.08}s both`,
                                    }}
                                />
                            );
                        })}

                        {/* FLAGGED badge */}
                        <div style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: borderColor,
                            color: '#fff',
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            letterSpacing: '0.5px',
                            textTransform: 'uppercase',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        }}>
                            {ocrLoading ? 'SCANNING' : `${matchedLines.length} LINE(S) FLAGGED`}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        {noteImages[selectedImage]?.name || `Document ${selectedImage + 1}`}
                        {noteImages.length > 1 && ` (${selectedImage + 1} of ${noteImages.length})`}
                    </div>
                </div>

                {/* Right: findings panel */}
                <div>
                    <div style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        color: 'var(--text-muted)',
                        marginBottom: '0.75rem',
                        paddingBottom: '0.5rem',
                        borderBottom: '1px solid var(--border-subtle)',
                    }}>
                        AI Findings from Billing Analysis
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '500px', overflowY: 'auto' }}>
                        {annotations.map((ann, i) => (
                            <div
                                key={i}
                                style={{
                                    background: `${ann.color}0c`,
                                    border: `1px solid ${ann.color}30`,
                                    borderLeft: `4px solid ${ann.color}`,
                                    borderRadius: '0 10px 10px 0',
                                    padding: '0.75rem 1rem',
                                    animation: `fadeInUp 0.4s ease-out ${0.2 + i * 0.1}s both`,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                    <span style={{
                                        background: ann.color,
                                        color: '#fff',
                                        fontSize: '0.55rem',
                                        fontWeight: 700,
                                        padding: '2px 7px',
                                        borderRadius: '3px',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                        flexShrink: 0,
                                    }}>{ann.type}</span>
                                    <span style={{ fontWeight: 600, fontSize: '0.8rem', color: ann.color }}>{ann.label}</span>
                                </div>
                                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                                    {ann.detail.substring(0, 200)}{ann.detail.length > 200 ? '...' : ''}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* OCR matched text preview */}
                    {matchedLines.length > 0 && (
                        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
                            <div style={{
                                fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '0.5rem',
                            }}>OCR-Detected Flagged Text</div>
                            {matchedLines.map((line, i) => (
                                <div key={i} style={{
                                    fontSize: '0.72rem',
                                    color: borderColor,
                                    padding: '0.3rem 0.5rem',
                                    background: `${borderColor}08`,
                                    borderRadius: '4px',
                                    marginBottom: '0.3rem',
                                    fontStyle: 'italic',
                                    borderLeft: `3px solid ${borderColor}`,
                                }}>
                                    &ldquo;{line.text}&rdquo;
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ================================================================
// FEATURE PANELS
// ================================================================

function CrossModalPanel({
    result,
    noteImages,
}: {
    result: FullAnalysisResult;
    noteImages: { name: string; url: string }[];
}) {
    const { cross_modal } = result;

    return (
        <div className="animate-in">
            {/* Annotated document viewer */}
            {noteImages.length > 0 && cross_modal.mismatches.length > 0 && (
                <AnnotatedDocumentViewer
                    noteImages={noteImages}
                    annotations={cross_modal.mismatches.map(m => ({
                        label: `Conflict: ${m.cpt_code}`,
                        detail: m.explanation,
                        type: 'CROSS_MODAL',
                        color: '#ef4444',
                    }))}
                />
            )}

            <div className="panel">
                <div className="panel-header">
                    <h2>Severity Audit Findings</h2>
                    <span className={`status status-${cross_modal.risk_level.toLowerCase()}`}>
                        {cross_modal.risk_level} RISK
                    </span>
                </div>
                {cross_modal.mismatches.length === 0 ? (
                    <div className="alert-box info">
                        <span>No severity mismatches detected. All billing codes align with clinical documentation.</span>
                    </div>
                ) : (
                    cross_modal.mismatches.map((m, i) => (
                        <div key={i} style={{ marginBottom: '1.5rem' }}>
                            <div className="alert-box danger">
                                <span>{m.explanation}</span>
                            </div>
                            <div className="split-view">
                                {/* Billed Claim Details Panel */}
                                <div>
                                    <div className="text-xs text-muted mb-1" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                                        Billed Claim Details — {m.claim_id}
                                    </div>
                                    <div className="notes-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <span className="text-xs text-muted">Billed Code</span>
                                            <span className="mono font-bold text-danger">{m.cpt_code}</span>
                                        </div>
                                        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <div className="text-xs text-muted mb-1">Description</div>
                                            <div className="text-sm">{m.cpt_description}</div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <span className="text-xs text-muted">Billed Amount</span>
                                            <span className="font-bold text-danger">₹{m.billed_amount.toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span className="text-xs text-muted">Department</span>
                                            <span className="text-sm font-bold">{m.department || 'Emergency'}</span>
                                        </div>
                                    </div>
                                </div>
                                {/* Severity Comparison */}
                                <div>
                                    <div className="text-xs text-muted mb-1" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                                        Severity Comparison
                                    </div>
                                    <div className="severity-item">
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                            <span className="mono">{m.cpt_code}</span> — {m.cpt_description}
                                        </div>
                                        <div className="severity-bar-container">
                                            <span className="severity-label">Billed</span>
                                            <div className="severity-bar">
                                                <div className="severity-fill bill" style={{ width: `${(m.billed_severity / 5) * 100}%` }} />
                                            </div>
                                            <span className="severity-value text-danger">{m.billed_severity}/5</span>
                                        </div>
                                        <div className="severity-bar-container">
                                            <span className="severity-label">Actual</span>
                                            <div className="severity-bar">
                                                <div className="severity-fill note" style={{ width: `${(Math.max(m.note_severity, 0) / 5) * 100}%` }} />
                                            </div>
                                            <span className="severity-value text-success">{m.note_severity}/5</span>
                                        </div>
                                        <div className="mismatch-arrow">Gap: Level {m.severity_gap}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                            Billed: ₹{m.billed_amount.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

/** Highlight keywords in text with red markup */
function highlightText(text: string, keywords: string[]) {
    if (!keywords.length) return <span>{text}</span>;

    // Build a regex that matches any keyword
    const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(pattern);

    return (
        <>
            {parts.map((part, i) => {
                const isMatch = keywords.some(k => part.toLowerCase() === k.toLowerCase());
                return isMatch ? (
                    <span key={i} className="highlight-red">{part}</span>
                ) : (
                    <span key={i}>{part}</span>
                );
            })}
        </>
    );
}

function TimelinePanel({ result, noteImages }: { result: FullAnalysisResult; noteImages: { name: string; url: string }[] }) {
    const { timeline } = result;
    const events = timeline.events;
    if (events.length === 0) return null;

    const allTimes = events.flatMap(e => [new Date(e.start_time).getTime(), new Date(e.end_time).getTime()]);
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const range = maxTime - minTime || 1;
    const getPosition = (time: string) => ((new Date(time).getTime() - minTime) / range) * 100;
    const getWidth = (start: string, end: string) => ((new Date(end).getTime() - new Date(start).getTime()) / range) * 100;
    const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const flaggedIds = new Set<string>();
    timeline.overlaps.forEach(o => { flaggedIds.add(o.event_a.claim_id); flaggedIds.add(o.event_b.claim_id); });
    const barColors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];

    return (
        <div className="animate-in">
            {/* Annotated document viewer for timeline conflicts */}
            {noteImages.length > 0 && timeline.overlaps.length > 0 && (
                <AnnotatedDocumentViewer
                    noteImages={noteImages}
                    annotations={timeline.overlaps.map(o => ({
                        label: `${o.event_a.department} ↔ ${o.event_b.department}`,
                        detail: o.explanation,
                        type: o.type === 'TELEPORTATION' ? 'TELEPORTATION' : 'OVERLAP',
                        color: o.type === 'TELEPORTATION' ? '#ef4444' : '#f59e0b',
                    }))}
                />
            )}
            <div className="panel">
                <div className="panel-header">
                    <h2>Temporal Integrity Analysis</h2>
                    <span className={`status status-${timeline.risk_level.toLowerCase()}`}>
                        {timeline.flagged_count} Flag(s)
                    </span>
                </div>
                {timeline.overlaps.map((o, i) => (
                    <div className={`alert-box ${o.type === 'TELEPORTATION' ? 'danger' : 'warning'}`} key={i}>
                        <span>{o.explanation}</span>
                    </div>
                ))}
                <div className="timeline-container" style={{ marginTop: '1rem' }}>
                    {events.map((event, i) => {
                        const left = getPosition(event.start_time);
                        const width = Math.max(getWidth(event.start_time, event.end_time), 3);
                        const isFlagged = flaggedIds.has(event.claim_id);
                        return (
                            <div className="gantt-row" key={i} style={{ animation: `slideIn 0.4s ease-out ${i * 0.1}s both` }}>
                                <div className="gantt-label">
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8rem' }}>{event.claim_id}</div>
                                    <div>{event.department}</div>
                                </div>
                                <div className="gantt-track">
                                    <div
                                        className={`gantt-bar ${isFlagged ? (timeline.overlaps.some(o =>
                                            (o.event_a.claim_id === event.claim_id || o.event_b.claim_id === event.claim_id) && o.type === 'TELEPORTATION'
                                        ) ? 'teleport' : 'overlap') : 'normal'}`}
                                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: isFlagged ? undefined : barColors[i % barColors.length] }}
                                        title={`${event.procedure}\n${formatTime(event.start_time)} — ${formatTime(event.end_time)}`}
                                    >
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {formatTime(event.start_time)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function GhostUnbundlePanel({
    result,
    noteImages,
}: {
    result: FullAnalysisResult;
    noteImages: { name: string; url: string }[];
}) {
    const { ghost_unbundle } = result;

    return (
        <div className="animate-in">
            {noteImages.length > 0 && (ghost_unbundle.ghost_services.length > 0 || ghost_unbundle.unbundling_alerts.length > 0) && (
                <AnnotatedDocumentViewer
                    noteImages={noteImages}
                    annotations={[
                        ...ghost_unbundle.ghost_services.map(g => ({
                            label: `${g.cpt_code} — ${g.cpt_description}`,
                            detail: g.explanation,
                            type: 'GHOST',
                            color: '#f97316',
                        })),
                        ...ghost_unbundle.unbundling_alerts.map(u => ({
                            label: u.involved_codes.join(' + '),
                            detail: u.explanation,
                            type: 'UNBUNDLING',
                            color: '#f59e0b',
                        })),
                    ]}
                />
            )}
            {ghost_unbundle.unbundling_alerts.length > 0 && (
                <div className="panel">
                    <div className="panel-header">
                        <h2>Unbundling Detection</h2>
                        <span className="status status-high">{ghost_unbundle.unbundling_alerts.length} Violation(s)</span>
                    </div>
                    {ghost_unbundle.unbundling_alerts.map((u, i) => (
                        <div key={i}>
                            <div className="alert-box warning">
                                <div>{u.explanation}</div>
                            </div>
                            <div style={{ margin: '0.75rem 0 1rem 1.5rem', padding: '1rem', borderLeft: '3px solid var(--accent-amber)', background: 'var(--bg-secondary)', borderRadius: '0 8px 8px 0' }}>
                                <div className="text-xs text-muted mb-1" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Codes billed separately:
                                </div>
                                {u.involved_codes.map((code, ci) => (
                                    <div key={ci} className="text-sm" style={{ padding: '0.25rem 0' }}>
                                        <span className="mono text-danger">{code}</span> — {u.involved_descriptions[ci]}
                                    </div>
                                ))}
                                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span className="text-sm">Billed: <strong className="text-danger">₹{u.total_billed.toLocaleString()}</strong></span>
                                    <span className="text-sm">→</span>
                                    <span className="text-sm">Correct ({u.correct_code}): <strong className="text-success">₹{u.correct_cost.toLocaleString()}</strong></span>
                                    <span className="savings-badge positive">Save ₹{u.potential_savings.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {ghost_unbundle.ghost_services.length > 0 && (
                <div className="panel" style={{ borderLeft: '4px solid var(--accent-orange)' }}>
                    <div className="panel-header">
                        <h2>Ghost Services Detection</h2>
                        <span className="status status-high">{ghost_unbundle.ghost_services.length} Suspicious Items</span>
                    </div>
                    {ghost_unbundle.ghost_services.map((g, i) => (
                        <div key={i} style={{ marginBottom: '1.5rem' }}>
                            <div className="alert-box danger" style={{ background: 'rgba(239, 68, 68, 0.08)' }}>
                                <div>{g.explanation}</div>
                            </div>
                            <div className="split-view">
                                {/* Billed Claim Details Panel */}
                                <div>
                                    <div className="text-xs text-muted mb-1" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                                        Billed Details — {g.claim_id}
                                    </div>
                                    <div className="notes-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <span className="text-xs text-muted">Billed Code</span>
                                            <span className="mono font-bold text-danger">{g.cpt_code}</span>
                                        </div>
                                        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <div className="text-xs text-muted mb-1">Description</div>
                                            <div className="text-sm">{g.cpt_description}</div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                                            <span className="text-xs text-muted">Billed Amount</span>
                                            <span className="font-bold text-danger">₹{g.billed_amount.toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span className="text-xs text-muted">Category</span>
                                            <span className="text-sm font-bold">Procedure / Scan</span>
                                        </div>
                                    </div>
                                </div>
                                {/* Technical Evidence */}
                                <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '1rem' }}>
                                    <div className="text-xs text-muted mb-1" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                                        Audit Evidence
                                    </div>
                                    <div style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
                                        <div style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>Match Confidence for {g.cpt_code}:</div>
                                        <div style={{ height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                                            <div style={{ height: '100%', width: `${Math.min(g.similarity_score * 300, 100)}%`, background: g.similarity_score < 0.1 ? 'var(--accent-red)' : 'var(--accent-orange)' }} />
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                            Score: <strong>{(g.similarity_score * 100).toFixed(1)}%</strong>
                                            <p style={{ marginTop: '0.5rem' }}>No technical keywords found in the clinical notes that correspond to this billed service.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {ghost_unbundle.ghost_services.length === 0 && ghost_unbundle.unbundling_alerts.length === 0 && (
                <div className="panel">
                    <div className="panel-header"><h2>Ghost &amp; Unbundling Audit</h2><span className="status status-low">Read</span></div>
                    <div className="alert-box info">No ghost services or unbundling violations detected.</div>
                </div>
            )}

            {ghost_unbundle.total_potential_savings > 0 && (
                <div className="panel" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                    <div style={{ textAlign: 'center', padding: '1rem' }}>
                        <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: '0.5rem' }}>Total Potential Savings</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-emerald)', letterSpacing: '-2px' }}>₹{ghost_unbundle.total_potential_savings.toLocaleString()}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

function XAIPanel({ result }: { result: FullAnalysisResult }) {
    const { xai } = result;
    const strengths = xai.factors.filter(f => f.direction === 'SAFE');
    const risks = xai.factors.filter(f => f.direction === 'RISK');
    const totalFlags = result.cross_modal.flagged_count + result.timeline.flagged_count + result.ghost_unbundle.flagged_count;
    const verdictClass = xai.recommendation === 'APPROVE' ? 'approve' : xai.recommendation === 'REJECT' ? 'reject' : xai.recommendation === 'ESCALATE' ? 'escalate' : 'review';
    const verdictLabel = { APPROVE: 'Approve for Payment', REJECT: 'Refer for Detailed Audit', ESCALATE: 'Escalate — Senior Review', REVIEW: 'Hold for Clarification' }[xai.recommendation] || xai.recommendation;

    const [animatedBilled, setAnimatedBilled] = useState(0);
    const [animatedVerified, setAnimatedVerified] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => {
            setAnimatedBilled(xai.financial_summary.billed_amount);
            setAnimatedVerified(xai.financial_summary.expected_amount);
        }, 400);
        return () => clearTimeout(t);
    }, [xai]);

    const maxAmount = Math.max(xai.financial_summary.billed_amount, xai.financial_summary.expected_amount, 1);
    const billedPct = (animatedBilled / maxAmount) * 100;
    const verifiedPct = (animatedVerified / maxAmount) * 100;

    return (
        <div className="animate-in">
            {/* ── Verdict Banner ── */}
            <div className="panel" style={{ borderTop: `4px solid ${xai.risk_score >= 75 ? 'var(--accent-red)' : xai.risk_score >= 50 ? 'var(--accent-amber)' : 'var(--accent-emerald)'}`, marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                            Audit Summary — {result.patient_name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <span className={`verdict-chip ${verdictClass}`}>{verdictLabel}</span>
                            <span className="text-sm text-muted">{result.total_claims} procedures · ₹{result.total_billed.toLocaleString()} submitted</span>
                        </div>
                    </div>
                </div>

                {/* Engine status badges */}
                <div className="engine-status-row">

                    {[
                        { label: 'Severity Audit', count: result.cross_modal.flagged_count, risk: result.cross_modal.risk_level },
                        { label: 'Timeline Check', count: result.timeline.flagged_count, risk: result.timeline.risk_level },
                        { label: 'Financial Audit', count: result.ghost_unbundle.flagged_count, risk: result.ghost_unbundle.risk_level },
                    ].map((eng, i) => {
                        const color = eng.risk === 'CRITICAL' ? '#ef4444' : eng.risk === 'HIGH' ? '#f59e0b' : eng.risk === 'MEDIUM' ? '#3b82f6' : '#10b981';
                        return (
                            <span key={i} className="engine-badge">
                                <span className="dot" style={{ background: color }} />
                                {eng.label} — {eng.count} flag{eng.count !== 1 ? 's' : ''}
                            </span>
                        );
                    })}
                    <span className="engine-badge">
                        <span className="dot" style={{ background: '#10b981' }} />
                        Total Potential Recovery — ₹{result.ghost_unbundle.total_potential_savings.toLocaleString()}
                    </span>
                </div>

                {/* ── Scorecard ── */}
                <div className="scorecard-row" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
                    <div className={`stat-metric metric-${xai.risk_score >= 75 ? 'red' : xai.risk_score >= 25 ? 'amber' : 'green'}`}>
                        <div className="stat-metric-label">Risk Score</div>
                        <div className="stat-metric-value">{xai.risk_score}</div>
                        <div className="stat-metric-sub">Out of 100 · {xai.risk_level}</div>
                    </div>
                    <div className="stat-metric metric-blue">
                        <div className="stat-metric-label">Claims Reviewed</div>
                        <div className="stat-metric-value">{result.total_claims}</div>
                        <div className="stat-metric-sub">Line items analyzed</div>
                    </div>
                    <div className="stat-metric metric-red">
                        <div className="stat-metric-label">Total Flags</div>
                        <div className="stat-metric-value">{totalFlags}</div>
                        <div className="stat-metric-sub">Across all engines</div>
                    </div>
                    <div className="stat-metric metric-green">
                        <div className="stat-metric-label">Potential Savings</div>
                        <div className="stat-metric-value">₹{(result.ghost_unbundle.total_potential_savings / 1000).toFixed(0)}K</div>
                        <div className="stat-metric-sub">From financial exceptions</div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>

                {/* ── Financial Reconciliation ── */}
                <div className="panel" style={{ marginBottom: 0 }}>
                    <div className="panel-header" style={{ marginBottom: '1.25rem' }}>
                        <h2>Financial Reconciliation</h2>
                        <span className="status status-medium">₹{xai.financial_summary.potential_savings.toLocaleString()} leakage</span>
                    </div>
                    <div className="comparison-bar-container">
                        <div className="comparison-row">
                            <div className="comparison-label">Billed Amount</div>
                            <div className="comparison-bar-track">
                                <div className="comparison-bar-fill billed" style={{ width: `${billedPct}%` }} />
                            </div>
                            <div className="comparison-value text-danger">₹{xai.financial_summary.billed_amount.toLocaleString()}</div>
                        </div>
                        <div className="comparison-row">
                            <div className="comparison-label">Verified Amount</div>
                            <div className="comparison-bar-track">
                                <div className="comparison-bar-fill verified" style={{ width: `${verifiedPct}%` }} />
                            </div>
                            <div className="comparison-value text-success">₹{xai.financial_summary.expected_amount.toLocaleString()}</div>
                        </div>
                    </div>
                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                        <div style={{ textAlign: 'center', padding: '0.75rem 2rem', background: 'rgba(239,68,68,0.05)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.12)' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Overstated By</div>
                            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--accent-red)' }}>₹{xai.financial_summary.potential_savings.toLocaleString()}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>from ghost services &amp; unbundling</div>
                        </div>
                    </div>

                    {/* Flag Distribution */}
                    <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '1rem' }}>Flag Distribution</div>
                        <FlagDistributionChart result={result} />
                    </div>
                </div>

                {/* ── Integrity Score Waterfall ── */}
                <div className="panel" style={{ marginBottom: 0 }}>
                    <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
                        <h2>Risk Factor Breakdown</h2>
                    </div>
                    <RiskGauge score={xai.risk_score} level={xai.risk_level} />
                    <WaterfallChart factors={xai.factors} />
                </div>
            </div>


            {/* ── Findings Columns ── */}
            <div className="panel">
                <div className="panel-header">
                    <h2>360-Degree Audit Findings</h2>
                    <span className="text-xs text-muted">{strengths.length} passing · {risks.length} flagged</span>
                </div>
                <div className="finding-grid">
                    {/* Strengths */}
                    <div>
                        <div className="finding-column-label" style={{ color: 'var(--accent-emerald)' }}>Compliance Strengths</div>
                        {strengths.length > 0 ? strengths.map((s, i) => (
                            <div key={i} className="finding-card safe" style={{ animationDelay: `${i * 0.05}s` }}>
                                <div className="finding-card-header">
                                    <div className="finding-card-title">{s.name}</div>
                                    <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>Passed</span>
                                </div>
                                <div className="finding-card-body">{s.description}</div>
                            </div>
                        )) : <div className="text-sm text-muted" style={{ padding: '1rem' }}>No compliance strengths identified in this case.</div>}
                    </div>

                    {/* Risks */}
                    <div>
                        <div className="finding-column-label" style={{ color: 'var(--accent-red)' }}>Integrity Flags</div>
                        {risks.length > 0 ? risks.sort((a, b) => b.contribution - a.contribution).map((r, i) => (
                            <div key={i} className="finding-card risk" style={{ animationDelay: `${i * 0.05}s` }}>
                                <div className="finding-card-header">
                                    <div className="finding-card-title">{r.name}</div>
                                    <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>+{(r.contribution * 100).toFixed(0)}% risk</span>
                                </div>
                                <div className="finding-card-body">{r.description}</div>
                            </div>
                        )) : <div className="text-sm text-muted" style={{ padding: '1rem' }}>No integrity flags detected. This claim appears within expected parameters.</div>}
                    </div>
                </div>
            </div>

            {/* ── Analyst Brief ── */}
            <div className="panel">
                <div className="panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2>Analyst Brief</h2>
                        <span style={{ fontSize: '0.65rem', background: 'var(--bg-secondary)', padding: '0.2rem 0.5rem', borderRadius: '4px', color: 'var(--text-muted)', fontWeight: 700, border: '1px solid var(--border-subtle)' }}>AI POWERED BY MEGALLM</span>
                    </div>
                    <span className={`verdict-chip ${verdictClass}`} style={{ fontSize: '0.72rem', padding: '0.3rem 0.85rem' }}>{xai.recommendation}</span>
                </div>
                <div className="brief-text">
                    {xai.narrative.split('\n').map((line, i) => {
                        if (!line.trim()) return null;
                        if (line.startsWith('## ')) return <h2 key={i}>{line.replace('## ', '')}</h2>;
                        if (line.startsWith('### ')) return <h3 key={i}>{line.replace('### ', '')}</h3>;
                        if (line.startsWith('> ')) return <blockquote key={i}>{line.replace('> ', '')}</blockquote>;
                        const parts = line.split('**');
                        return <p key={i} style={{ marginBottom: '0.6rem' }}>{parts.map((part, pi) => pi % 2 === 1 ? <strong key={pi}>{part}</strong> : <span key={pi}>{part}</span>)}</p>;
                    })}
                </div>
            </div>
            {/* ── Officer Toolkit Chatbot — removed from here, now at DashboardContent root ── */}
        </div >
    );
}

// ================================================================
// MAIN DASHBOARD
// ================================================================






// ================================================================
// MAIN DASHBOARD
// ================================================================

function DashboardContent() {
    const searchParams = useSearchParams();
    const [result, setResult] = useState<FullAnalysisResult | null>(null);
    const [noteImages, setNoteImages] = useState<{ name: string; url: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState(0);
    const [loadingPhase, setLoadingPhase] = useState('Initializing engines...');

    useEffect(() => {
        const source = searchParams.get('source');
        const demo = searchParams.get('demo');

        async function runAnalysis() {
            setLoading(true);

            const phases = [
                'Loading claim data...',
                'Running Cross-Modal Auditor...',
                'Running Timeline Detective...',
                'Running Ghost & Unbundling Hunter...',
                'Generating XAI Explanation...',
                'Compiling results...',
            ];

            let phaseIndex = 0;
            const phaseInterval = setInterval(() => {
                phaseIndex = (phaseIndex + 1) % phases.length;
                setLoadingPhase(phases[phaseIndex]);
            }, 500);

            try {
                let claims;

                if (source === 'upload') {
                    // Load from in-memory store (user uploaded)
                    const stored = getUploadData();
                    if (!stored) throw new Error('No uploaded data found. Please go back and upload again.');
                    claims = stored.claims;
                    if (stored.noteImages) setNoteImages(stored.noteImages);
                } else {
                    // Load demo data
                    const dataFile = demo === 'priya' ? '/data/priya_claims.json' : '/data/vikram_claims.json';
                    const res = await fetch(dataFile);
                    claims = await res.json();
                }

                const analysisRes = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ claims }),
                });

                if (!analysisRes.ok) {
                    const errBody = await analysisRes.json().catch(() => ({}));
                    throw new Error(errBody.details || errBody.error || `API returned ${analysisRes.status}`);
                }

                const analysisResult = await analysisRes.json();

                // Validate the result has expected shape
                if (!analysisResult.cross_modal || !analysisResult.timeline || !analysisResult.ghost_unbundle || !analysisResult.xai) {
                    throw new Error('Analysis returned incomplete results. Check server logs.');
                }

                await new Promise(resolve => setTimeout(resolve, 1200));
                setResult(analysisResult);
            } catch (error) {
                console.error('Analysis failed:', error);
                setErrorMsg(error instanceof Error ? error.message : 'Unknown error');
            } finally {
                clearInterval(phaseInterval);
                setLoading(false);
            }
        }

        runAnalysis();
    }, [searchParams]);

    if (loading) {
        return (
            <div className="loading-container">
                <div className="loading-spinner" />
                <div>
                    <div className="loading-text">{loadingPhase}</div>
                    <div className="loading-subtext">4 analysis engines processing claim data...</div>
                </div>
            </div>
        );
    }

    if (!result) {
        return (
            <div className="loading-container">
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-red)' }}>Error</div>
                <div className="loading-text">Analysis failed</div>
                {errorMsg && <div className="text-sm text-muted" style={{ maxWidth: '500px', textAlign: 'center', marginTop: '0.5rem' }}>{errorMsg}</div>}
                <a href="/" className="btn btn-primary" style={{ marginTop: '1rem' }}>← Back to Upload</a>
            </div>
        );
    }

    const tabs = [
        { label: 'Audit Summary', count: null, risk: result.xai.risk_level },
        { label: 'Severity Details', count: result.cross_modal.flagged_count, risk: result.cross_modal.risk_level },
        { label: 'Timeline Details', count: result.timeline.flagged_count, risk: result.timeline.risk_level },
        { label: 'Financial Exceptions', count: result.ghost_unbundle.flagged_count, risk: result.ghost_unbundle.risk_level },
    ];

    const badgeClass = (risk: string) => {
        switch (risk) {
            case 'CRITICAL': return 'badge-danger';
            case 'HIGH': return 'badge-warn';
            case 'MEDIUM': return 'badge-info';
            default: return 'badge-success';
        }
    };

    return (
        <div className="dashboard">
            <div className="dashboard-header animate-in">
                <div>
                    <h1>
                        Audit Report: {result.patient_name}
                    </h1>
                    <div className="subtitle">
                        Analyzed {result.total_claims} line items • Total billed: ₹{result.total_billed.toLocaleString()} • {new Date(result.analysis_timestamp).toLocaleString()}
                        {noteImages.length > 0 && ` • ${noteImages.length} document(s) attached`}
                    </div>
                </div>
                <div className="header-actions">
                    <a href="/" className="btn btn-outline btn-sm">New Audit</a>
                    <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Export Report</button>
                </div>
            </div>



            <div className="tabs animate-in animate-in-delay-2">
                {tabs.map((tab, i) => (
                    <button key={i} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
                        {tab.label}
                        {tab.count !== null && <span className={`badge ${badgeClass(tab.risk)}`}>{tab.count}</span>}
                    </button>
                ))}
            </div>

            <div className="animate-in animate-in-delay-3">
                {activeTab === 0 && <XAIPanel result={result} />}
                {activeTab === 1 && <CrossModalPanel result={result} noteImages={noteImages} />}
                {activeTab === 2 && <TimelinePanel result={result} noteImages={noteImages} />}
                {activeTab === 3 && <GhostUnbundlePanel result={result} noteImages={noteImages} />}
            </div>

            <div className="alert-box info" style={{ marginTop: '2rem' }}>
                <span>
                    <strong>Advisory Notice:</strong> This system operates strictly as an analytical tool. All flagged items are recommendations for human review.
                    No automated enforcement or legal decisions are made. Final determination rests with the authorized claims officer.
                </span>
            </div>

            {/* ── Officer Toolkit — at root for proper fixed positioning ── */}
            <OfficerToolkit result={result} />
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={
            <div className="loading-container">
                <div className="loading-spinner" />
                <div className="loading-text">Loading dashboard...</div>
            </div>
        }>
            <DashboardContent />
        </Suspense>
    );
}
