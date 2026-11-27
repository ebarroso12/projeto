import qrcode from 'qrcode-generator';

/** QR code em SVG gerado no próprio aparelho (nenhum serviço externo vê o link). */
export function qrSvg(texto: string, px = 132): string {
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  const n = q.getModuleCount(), cel = Math.max(2, Math.floor(px / (n + 8)));
  return q.createSvgTag({ cellSize: cel, margin: cel * 4, scalable: true });
}
