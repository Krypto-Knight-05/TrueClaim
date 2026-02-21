'use client';

import { useRouter } from 'next/navigation';
import { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { setUploadData } from '@/lib/store';
import { recognizeLines } from '@/lib/ocr';

interface UploadedData {
  claims: Record<string, string | number | undefined>[];
  noteImages: { name: string; url: string }[];
}

export default function HomePage() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [csvPreview, setCsvPreview] = useState<Record<string, string | number>[]>([]);
  const [noteUrls, setNoteUrls] = useState<{ name: string; url: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const csvInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const handleCsvUpload = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Please upload a .csv file for billing data');
      return;
    }
    setCsvFile(file);
    setError('');

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(`CSV parsing error: ${results.errors[0].message}`);
          return;
        }
        const data = results.data as Record<string, string | number>[];
        setCsvPreview(data);
      },
    });
  }, []);

  const handleNoteUpload = useCallback((files: File[]) => {
    const imageFiles = files.filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    setNoteFiles(prev => [...prev, ...imageFiles]);

    const urls = imageFiles.map(f => ({
      name: f.name,
      url: URL.createObjectURL(f),
    }));
    setNoteUrls(prev => [...prev, ...urls]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);

    const csv = files.find(f => f.name.endsWith('.csv'));
    const images = files.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');

    if (csv) handleCsvUpload(csv);
    if (images.length) handleNoteUpload(images);
  }, [handleCsvUpload, handleNoteUpload]);

  const handleAnalyze = async () => {
    if (csvPreview.length === 0) {
      setError('Please upload a CSV file first');
      return;
    }

    // Map CSV columns to our expected ClaimItem format (handles many naming variations)
    const claims = csvPreview.map((row, idx) => {
      // Handle time — could be single "10:00" or range "10:00 - 12:00"
      const rawTime = String(row['time'] || row['Time'] || row['service_time'] || '12:00');
      const time = rawTime.includes('-') ? rawTime.split('-')[0].trim() : rawTime.trim();

      // Handle location — could be text like "Fortis Rohini - OR 4" or lat/lng columns
      const locText = String(row['location'] || row['Location'] || '');
      // Generate deterministic pseudo-coordinates from location text for geospatial analysis
      let lat: number | undefined;
      let lng: number | undefined;
      if (row['location_lat']) {
        lat = Number(row['location_lat']);
        lng = Number(row['location_lng']);
      } else if (locText) {
        // Hash location name to generate consistent coordinates in the Delhi region
        const hash = locText.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        lat = 28.5 + (hash % 50) * 0.01;
        lng = 77.0 + ((hash * 7) % 50) * 0.01;
      }

      const claim: Record<string, string | number | undefined> = {
        claim_id: String(row['claim_id'] || row['Claim_ID'] || row['ClaimID'] || row['item_id'] || `CLM-${idx + 1}`),
        patient_name: String(row['patient_name'] || row['Patient_Name'] || row['PatientName'] || ''),
        date: String(row['date'] || row['Date'] || row['service_date'] || row['admission_date'] || ''),
        time: time,
        department: String(row['department'] || row['Department'] || row['dept'] || locText.split('-')[0]?.trim() || ''),
        cpt_code: String(row['cpt_code'] || row['CPT_Code'] || row['CPTCode'] || row['cpt'] || ''),
        cpt_description: String(row['cpt_description'] || row['CPT_Description'] || row['description'] || ''),
        billed_amount_inr: Number(row['billed_amount_inr'] || row['Billed_Amount'] || row['amount'] || row['billed_amount'] || 0),
        recorded_clinical_notes: String(row['recorded_clinical_notes'] || row['Clinical_Notes'] || row['notes'] || row['clinical_notes'] || ''),
        location: locText,
      };
      if (lat !== undefined) { claim.location_lat = lat; claim.location_lng = lng; }
      return claim;
    });

    // Convert blob URLs to base64 for persistence
    let finalImages = noteUrls;
    if (noteFiles.length > 0) {
      finalImages = await Promise.all(
        noteFiles.map(async (file) =>
          new Promise<{ name: string; url: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, url: reader.result as string });
            reader.readAsDataURL(file);
          })
        )
      );
    }

    // ── OCR: Extract text from uploaded note images ──
    let ocrText = '';
    if (finalImages.length > 0) {
      setIsScanning(true);
      try {
        for (let i = 0; i < finalImages.length; i++) {
          setScanProgress(`Scanning document ${i + 1} of ${finalImages.length}...`);
          const result = await recognizeLines(finalImages[i].url);
          const pageText = result.lines.map(l => l.text).join('\n');
          ocrText += (ocrText ? '\n---\n' : '') + pageText;
        }
        console.log('[ClaimGuard] OCR extracted text length:', ocrText.length);
      } catch (err) {
        console.error('[ClaimGuard] OCR extraction failed:', err);
      }
      setIsScanning(false);
      setScanProgress('');
    }

    // Inject OCR text into claims that lack clinical notes
    if (ocrText.trim().length > 0) {
      for (const claim of claims) {
        if (!claim.recorded_clinical_notes || String(claim.recorded_clinical_notes).trim().length === 0) {
          claim.recorded_clinical_notes = ocrText;
        }
      }
    }

    // Store data in memory (avoids sessionStorage quota limits)
    setUploadData({ claims, noteImages: finalImages, ocrText });

    router.push('/dashboard?source=upload');
  };

  const loadDemo = (demo: string) => {
    router.push(`/dashboard?demo=${demo}`);
  };

  const removeNoteImage = (index: number) => {
    setNoteFiles(prev => prev.filter((_, i) => i !== index));
    setNoteUrls(prev => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <main>
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-badge">
          Professional Claims Intelligence Platform
        </div>
        <h1>
          Detect Insurance Fraud with{' '}
          <span className="gradient-text">Explainable AI</span>
        </h1>
        <p>
          Upload billing data (CSV) and clinical notes to detect upcoding,
          ghost services, timeline fraud, and unbundling — with transparent,
          human-readable explanations for every flag.
        </p>
      </section>

      {/* Upload Section */}
      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

          {/* CSV Upload */}
          <div
            className={`upload-zone ${isDragging ? 'active' : ''} ${csvFile ? 'active' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => csvInputRef.current?.click()}
          >
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleCsvUpload(e.target.files[0])}
            />
            <div className="upload-icon">CSV</div>
            <h3>{csvFile ? csvFile.name : 'Upload Billing CSV'}</h3>
            <p>
              {csvFile
                ? `${csvPreview.length} rows parsed successfully`
                : 'Structured billing data with CPT codes, amounts, clinical notes'}
            </p>
            {csvFile && (
              <div style={{ marginTop: '0.75rem' }}>
                <span className="savings-badge positive">Ready</span>
              </div>
            )}
          </div>

          {/* Note Images Upload */}
          <div
            className={`upload-zone ${noteUrls.length > 0 ? 'active' : ''}`}
            onClick={() => noteInputRef.current?.click()}
          >
            <input
              ref={noteInputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              style={{ display: 'none' }}
              onChange={e => e.target.files && handleNoteUpload(Array.from(e.target.files))}
            />
            <div className="upload-icon">DOC</div>
            <h3>{noteUrls.length > 0 ? `${noteUrls.length} Document(s) Added` : "Upload Clinical Notes / Bills"}</h3>
            <p>
              {noteUrls.length > 0
                ? 'Click to add more documents'
                : 'Images or PDFs of clinical notes, bills, prescriptions'}
            </p>
          </div>
        </div>

        {/* Note image thumbnails */}
        {noteUrls.length > 0 && (
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {noteUrls.map((img, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={img.url}
                  alt={img.name}
                  style={{
                    width: '100px',
                    height: '100px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeNoteImage(i); }}
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    background: 'var(--accent-red)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
                <div className="text-xs text-muted" style={{ textAlign: 'center', marginTop: '0.25rem', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {img.name}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CSV Preview */}
        {csvPreview.length > 0 && (
          <div className="panel" style={{ marginTop: '1.5rem', maxHeight: '300px', overflow: 'auto' }}>
            <div className="panel-header">
              <h2>Billing Data Preview — {csvPreview.length} Claims</h2>
              <span className="status status-low">Read</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="audit-table">
                <thead>
                  <tr>
                    {Object.keys(csvPreview[0]).slice(0, 6).map(key => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {Object.keys(csvPreview[0]).slice(0, 6).map(key => (
                        <td key={key} className="text-sm">{String(row[key] ?? '').substring(0, 50)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvPreview.length > 5 && (
                <div className="text-xs text-muted" style={{ padding: '0.5rem 1rem' }}>
                  ... and {csvPreview.length - 5} more rows
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="alert-box danger" style={{ marginTop: '1rem' }}>
            <span className="alert-icon">!</span>
            <span>{error}</span>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleAnalyze}
            disabled={csvPreview.length === 0 || isScanning}
            style={{ opacity: (csvPreview.length === 0 || isScanning) ? 0.5 : 1 }}
          >
            {isScanning ? `Audit in progress...` : 'Run Smart Audit'}
          </button>
        </div>

      </section>

      {/* Features Grid */}
      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-icon" style={{ background: 'rgba(37, 99, 235, 0.05)' }}>CM</div>
          <h3>Cross-Modal Auditor</h3>
          <p>Compares billing code severity against clinical note evidence. Identifies upcoding discrepancies with high precision.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" style={{ background: 'rgba(37, 99, 235, 0.05)' }}>TD</div>
          <h3>Timeline Detective</h3>
          <p>Analyzes temporal data for physically impossible overlaps or concurrent procedures at different locations.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" style={{ background: 'rgba(37, 99, 235, 0.05)' }}>GH</div>
          <h3>Ghost Hunter</h3>
          <p>Detects phantom charges with no clinical documentation and unbundled codes billed to artificially inflate costs.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" style={{ background: 'rgba(37, 99, 235, 0.05)' }}>XA</div>
          <h3>Transparent Advisor</h3>
          <p>Feature attribution models and clear narratives justify every audit flag for human review.</p>
        </div>
      </section>

      {/* Stats bar */}
      <section style={{ padding: '3rem 2rem', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4rem', flexWrap: 'wrap', maxWidth: '800px', margin: '0 auto' }}>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-blue)' }}>4</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Detection Engines</div>
          </div>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-emerald)' }}>100%</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Explainable</div>
          </div>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-purple)' }}>0</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Black Box Decisions</div>
          </div>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-amber)' }}>Advisory</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not Enforcement</div>
          </div>
        </div>
      </section>
    </main>
  );
}
