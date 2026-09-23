import sharp from 'sharp';
import type { ScreenshotRedactor } from '@ownpilot/core/computer';
import {
  COMPUTER_VIEWPORT,
  COMPUTER_MAX_SCREENSHOT_BYTES,
  COMPUTER_SENSITIVE_KINDS,
  disclosableText,
} from '@ownpilot/core/computer';

/** Page-derived text is escaped before it enters the SVG mask. */
function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c
  );
}

/**
 * Fail-closed structural view: no original page pixels survive. Since Phase 6.9
 * a short, conservatively classified label may be drawn INTO the mask, so the
 * model can perceive non-control changes. Sensitive kinds never carry one.
 */
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
    let disclosedLabels = 0;
    const boxes = image.layout.controls
      .map(({ x, y, width, height, kind, text, state }) => {
        if (
          ![x, y, width, height].every(Number.isFinite) ||
          x < 0 ||
          y < 0 ||
          width <= 0 ||
          height <= 0 ||
          x + width > 1280 ||
          y + height > 800 ||
          ![
            'Button',
            'Link',
            'Field',
            'Password',
            'Secret',
            'Authentication',
            'Select',
            'Text',
            'Heading',
          ].includes(kind)
        )
          throw new Error('Invalid redaction geometry');
        const sensitive = COMPUTER_SENSITIVE_KINDS.includes(kind);
        if (sensitive) sensitiveControls++;
        if (state && !['disabled', 'checked', 'selected'].includes(state))
          throw new Error('Invalid redaction state');
        // Re-run the disclosure classifier here rather than trusting the
        // capture. This module is the last thing between a page string and the
        // model, so it re-derives the decision instead of inheriting it; a
        // sensitive kind never discloses text whatever the capture said.
        const label = sensitive ? undefined : disclosableText(text);
        if (label) disclosedLabels++;
        // `kind` and `state` are server constants. `label` is page-derived and
        // therefore XML-escaped; it can only ever be rendered as pixels.
        const caption = `${kind}${state ? ` (${state})` : ''}${label ? `: ${escapeXml(label)}` : ''}`;
        const fill = sensitive ? '#c9c9c9' : '#e6e6e6';
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="#333"/><text x="${x + 3}" y="${Math.min(799, y + 13)}" font-size="11" fill="#111">${caption}</text>`;
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
      metadata: {
        method: 'opaque-structural-v2',
        maskedRegions: 1,
        sensitiveControls,
        disclosedLabels,
      },
    };
  }
}
