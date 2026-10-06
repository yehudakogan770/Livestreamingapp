/** A QR code picture's address (the SVG Lumora made). */
export const qrSrc = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * A QR code on screen. It is a picture (an <img>), never put into the page
 * as markup: an SVG shown as a picture can't run scripts, open links or load
 * anything, whatever an event file (perhaps from someone else) holds.
 */
export function QrImage({ svg, className }: { svg: string; className: string }) {
  return (
    <div className={className}>
      <img src={qrSrc(svg)} alt="QR code" draggable={false} />
    </div>
  );
}
