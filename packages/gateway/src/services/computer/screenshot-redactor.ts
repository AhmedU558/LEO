import sharp from 'sharp';
import type { ScreenshotRedactor } from '@ownpilot/core/computer';
import { COMPUTER_VIEWPORT, COMPUTER_MAX_SCREENSHOT_BYTES } from '@ownpilot/core/computer';

/** Fail-closed structural view: no original page pixels, labels or values survive. */
export class StructuralScreenshotRedactor implements ScreenshotRedactor {
  async redact({
    image,
    binding,
    observationId,
    signal,
  }: Parameters<ScreenshotRedactor['redact']>[0]) {
    signal.throwIfAborted();
    if (
      !binding.userId ||
      !binding.workspaceId ||
      !binding.executionTaskId ||
      !binding.sessionId ||
      !observationId ||
      image.width !== 1280 ||
      image.height !== 800 ||
      !image.layout?.revision ||
      !image.layout.controls.length ||
      image.layout.controls.length > 200 ||
      typeof image.screenshot !== 'string' ||
      image.screenshot.length > Math.ceil(COMPUTER_MAX_SCREENSHOT_BYTES / 3) * 4
    )
      throw new Error('Screenshot disclosure refused');
    const bytes = Buffer.from(image.screenshot, 'base64');
    if (bytes.length > COMPUTER_MAX_SCREENSHOT_BYTES) throw new Error('Screenshot size limit');
    const pipeline = sharp(bytes, { limitInputPixels: 1280 * 800, failOn: 'warning' });
    const metadata = await pipeline.metadata();
    if (
      metadata.format !== 'png' ||
      metadata.width !== 1280 ||
      metadata.height !== 800 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Unsupported screenshot');
    let sensitiveControls = 0;
    const boxes = image.layout.controls
      .map(({ x, y, width, height, kind }) => {
        if (
          ![x, y, width, height].every(Number.isFinite) ||
          x < 0 ||
          y < 0 ||
          width <= 0 ||
          height <= 0 ||
          x + width > 1280 ||
          y + height > 800 ||
          !['Button', 'Link', 'Field', 'Password', 'Secret', 'Authentication', 'Select'].includes(
            kind
          )
        )
          throw new Error('Invalid redaction geometry');
        if (['Password', 'Secret', 'Authentication'].includes(kind)) sensitiveControls++;
        // All labels are server constants; no page-controlled string is interpolated.
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e6e6e6" stroke="#333"/><text x="${x + 3}" y="${Math.min(799, y + 13)}" font-size="11" fill="#111">${kind}</text>`;
      })
      .join('');
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="white"/>${boxes}</svg>`
    );
    signal.throwIfAborted();
    const redacted = await pipeline
      .composite([{ input: mask }])
      .png()
      .toBuffer();
    signal.throwIfAborted();
    if (redacted.length > COMPUTER_MAX_SCREENSHOT_BYTES)
      throw new Error('Redacted screenshot size limit');
    return {
      observation: {
        screenshot: redacted.toString('base64'),
        viewport: { ...COMPUTER_VIEWPORT },
        untrusted: true as const,
        disclosure: 'redacted' as const,
      },
      metadata: { method: 'opaque-structural-v1', maskedRegions: 1, sensitiveControls },
    };
  }
}
