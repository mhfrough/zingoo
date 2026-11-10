/** a file ready to send to the server: base64 content, kept small */
export interface ProofFile {
  proofName: string;
  proofMime: string;
  proofData: string;
}

/** the biggest attachment accepted (the server enforces the same limit) */
export const MAX_PROOF_BYTES = 450_000;
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/** Reads a chosen image or PDF as base64. Rejects with a short message a person can act on. */
export function readProof(file: File): Promise<ProofFile> {
  if (!ALLOWED.test(file.type)) return Promise.reject(new Error('Attach an image (PNG, JPEG, WebP, GIF) or a PDF.'));
  if (file.size > MAX_PROOF_BYTES) return Promise.reject(new Error('The file is too large. Keep it under 450 KB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ proofName: file.name, proofMime: file.type, proofData: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}

/** Saves base64 content as a file through the browser's download. */
export function downloadBase64(name: string, mime: string, data: string): void {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  saveBlob(name, new Blob([bytes], { type: mime }));
}

/** Saves text (for example an HTML voucher) as a file. */
export function downloadText(name: string, mime: string, text: string): void {
  saveBlob(name, new Blob([text], { type: `${mime};charset=utf-8` }));
}

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
