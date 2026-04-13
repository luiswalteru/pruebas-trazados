import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateThumPngBlob } from './thumGenerator';

async function writeTrazadoFiles(folder, trazado) {
  folder.file('letter-fill.svg', trazado.fillSvg);
  folder.file('letter-outline.svg', trazado.outlineSvg);
  folder.file('letter-dotted.svg', trazado.dottedSvg);
  folder.file('data.json', JSON.stringify(trazado.dataJson, null, 2));

  const [w, h] = trazado.dataJson?.letterSize || [380, 340];
  const thumBlob = await generateThumPngBlob({
    fillPathD: trazado.fillPathD,
    strokePaths: trazado.strokePaths,
    dotList: trazado.dotList,
    width: w,
    height: h,
    dotRadius: Math.max(4, Math.round((trazado.dataJson?.dotSize || 12) / 4)),
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
