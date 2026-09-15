/**
 * Utility helpers
 */

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function extractFilesFromZip(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const files = [];
  const promises = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    const lower = relativePath.toLowerCase();
    if (!(/\.(jpg|jpeg|png|webp|gif|pdf)$/i.test(lower))) return;

    promises.push(
      zipEntry.async('blob').then(blob => {
        const name = relativePath.split('/').pop();
        const type = name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        files.push(new File([blob], name, { type }));
      })
    );
  });

  await Promise.all(promises);
  return files;
}

/**
 * Expand PDF pages to images (basic – first page only for MVP, or use pdf.js)
 * Note: full multi-page conversion needs canvas rendering.
 */
export async function pdfToImages(pdfFile, maxPages = 5) {
  // For MVP we treat PDF as single unit and let Gemini handle it if possible.
  // Advanced: use pdf.js to render pages to canvas → blob.
  // Placeholder: return the PDF itself so Gemini can process (Gemini supports PDF in some models).
  return [pdfFile];
}

export function saveConfig(cfg) {
  localStorage.setItem('sh_scoring_config', JSON.stringify(cfg));
}

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem('sh_scoring_config') || '{}');
  } catch {
    return {};
  }
}

export function clearConfig() {
  localStorage.removeItem('sh_scoring_config');
}
