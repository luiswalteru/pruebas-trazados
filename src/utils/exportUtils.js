import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// The exported bundle is intentionally small — only the two files the
// downstream player needs that *must* be generated from the user's drawing:
//   • data.json — the tracing coordinates, dot sizes and animation metadata
//   • base.svg  — the animatable SVG mirror of letters.js (paths + circle)
// Everything else (bg.svg, dotted.svg, character art, audio) is authored
// upstream and shipped by the content pipeline, so we don't re-emit them.
async function writeTrazadoFiles(folder, trazado) {
  folder.file('data.json', JSON.stringify(trazado.dataJson, null, 2));
  if (trazado.baseSvg) folder.file('base.svg', trazado.baseSvg);
}

export async function downloadSingleTrazado(trazado) {
  const zip = new JSZip();
  const folder = zip.folder(trazado.folderName);
  await writeTrazadoFiles(folder, trazado);
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${trazado.folderName}.zip`);
}

export async function exportAllTrazados(trazadosList, baseType) {
  const zip = new JSZip();
  const typeFolder = zip.folder(baseType); // 'ligada' or 'mayusculas'

  for (const trazado of trazadosList) {
    const folder = typeFolder.folder(trazado.folderName);
    await writeTrazadoFiles(folder, trazado);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `trazados-${baseType}.zip`);
}

/**
 * Write a trazado's files into the local reader bundle via the dev-server
 * middleware (`/__write-reader-trazado`, defined in vite.config.js). The dev
 * server writes to `public/reader/libro/assets/trazados/{type}/{folderName}/`
 * so the reader can serve the fresh trazado immediately.
 *
 * Only works in `npm run dev` — the middleware isn't registered in the prod
 * build. Throws on non-2xx responses with the server's error message.
 */
export async function writeTrazadoToReader(trazado, type) {
  const payload = {
    type,
    folderName: trazado.folderName,
    files: {
      'data.json': JSON.stringify(trazado.dataJson, null, 2),
      ...(trazado.baseSvg ? { 'base.svg': trazado.baseSvg } : {}),
    },
  };

  const res = await fetch('/__write-reader-trazado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
