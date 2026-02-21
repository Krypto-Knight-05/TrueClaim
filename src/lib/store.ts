// Simple in-memory store for passing upload data between pages
// Works because Next.js uses client-side navigation (no full page reload)

interface UploadStore {
    claims: Record<string, string | number | undefined>[];
    noteImages: { name: string; url: string }[];
    ocrText?: string; // OCR-extracted text from note images (fed into engines)
}

let _store: UploadStore | null = null;

export function setUploadData(data: UploadStore) {
    _store = data;
}

export function getUploadData(): UploadStore | null {
    return _store;
}

export function clearUploadData() {
    _store = null;
}
