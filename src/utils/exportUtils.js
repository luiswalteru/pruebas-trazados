import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateThumPngBlob } from './thumGenerator';

async function writeTrazadoFiles(folder, trazado) {
  folder.file('letter-fill.svg', trazado.fillSvg);
  folder.file('letter-outline.svg', trazado.outlineSvg);
  folder.file('letter-dotted.svg', trazado.dottedSvg);
  if (trazado.baseSvg) folder.file('base.svg', trazado.baseSvg);
  folder.file('data.json', JSON.stringify(trazado.dataJson, null, 2));

  const [w, h] = trazado.dataJson?.letterSize || [380, 340];
  const thumBlob = await generateThumPngBlob({
    fillSvg: trazado.fillSvg,
    dottedSvg: trazado.dottedSvg,
    width: w,
    height: h,
  });
  folder.file('thum.png', thumBlob);
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
 * Write a trazado's 5 files into the local reader bundle via the dev-server
 * middleware (`/__write-reader-trazado`, defined in vite.config.js). The dev
 * server writes to `public/reader/libro/assets/trazados/{type}/{folderName}/`
 * so the reader can serve the fresh trazado immediately.
 *
 * Only works in `npm run dev` — the middleware isn't registered in the prod
 * build. Throws on non-2xx responses with the server's error message.
 */
export async function writeTrazadoToReader(trazado, type) {
  const [w, h] = trazado.dataJson?.letterSize || [380, 340];
  const thumBlob = await generateThumPngBlob({
    fillSvg: trazado.fillSvg,
    dottedSvg: trazado.dottedSvg,
    width: w,
    height: h,
  });
  const thumBase64 = await blobToBase64(thumBlob);

  const payload = {
    type,
    folderName: trazado.folderName,
    files: {
      'data.json': JSON.stringify(trazado.dataJson, null, 2),
      'letter-fill.svg': trazado.fillSvg,
      'letter-outline.svg': trazado.outlineSvg,
      'letter-dotted.svg': trazado.dottedSvg,
      ...(trazado.baseSvg ? { 'base.svg': trazado.baseSvg } : {}),
      'thum.png': { base64: thumBase64 },
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is a dataURL like "data:image/png;base64,iVBOR..."
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
