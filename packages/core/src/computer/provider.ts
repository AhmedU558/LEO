import type { ComputerAction, ComputerActionResult } from './models.js';

export interface BrowserProvider {
  /**
   * Navigates to a specific URL
   */
  navigate(url: string): Promise<ComputerActionResult>;

  /**
   * Executes a browser-specific action (click, type, hover, scroll)
   */
  executeAction(action: ComputerAction): Promise<ComputerActionResult>;

  /**
   * Captures the current browser state including screenshot and accessibility tree
   */
  getState(): Promise<{ screenshotBase64: string; accessibilityTree: unknown }>;

  /**
   * Closes the browser session
   */
  close(): Promise<void>;
}

export interface ComputerUseProvider {
  /** Browser-scoped actuator. Only ComputerService may dispatch authorized actions. */
  initialize(signal: AbortSignal): Promise<void>;
  screenshot(): Promise<ComputerScreenshot>;
  inspectForRedaction?(): Promise<ComputerRedactionLayout>;
  mouseMove(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  mouseDown(x: number, y: number): Promise<void>;
  mouseUp(x: number, y: number): Promise<void>;
  scroll(deltaX: number, deltaY: number): Promise<void>;
  keyPress(key: string): Promise<void>;
  typeText(text: string): Promise<void>;
  hotkey(keys: readonly string[]): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Server-assigned role for a region. `Text` and `Heading` are non-control
 * regions, disclosed so that a dependent step can perceive page changes that
 * do not touch a native control.
 */
export type ComputerControlKind =
  | 'Button'
  | 'Link'
  | 'Field'
  | 'Password'
  | 'Secret'
  | 'Authentication'
  | 'Select'
  | 'Text'
  | 'Heading';

/** Kinds whose content is never disclosed, whatever it looks like. */
export const COMPUTER_SENSITIVE_KINDS: readonly ComputerControlKind[] = [
  'Password',
  'Secret',
  'Authentication',
];

/** Server constants only; never a page-controlled string. */
export type ComputerControlState = 'disabled' | 'checked' | 'selected';

export interface ComputerRedactionControl {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: ComputerControlKind;
  /**
   * A short visible label that passed {@link disclosableText}. Absent means the
   * text was sensitive, ambiguous or unclassifiable and stays masked — absence
   * is the fail-closed default, never an error.
   */
  text?: string;
  state?: ComputerControlState;
}

export interface ComputerRedactionLayout {
  readonly revision: string;
  readonly controls: readonly ComputerRedactionControl[];
}

/** Longest label that may be disclosed. UI labels are short; prose is not a label. */
export const COMPUTER_TEXT_MAX_CHARS = 40;
/** Most words a label may have. Prose fails closed. */
export const COMPUTER_TEXT_MAX_WORDS = 6;

/** Words that mark a string as credential-adjacent regardless of its shape. */
const SENSITIVE_WORDS =
  /pass(word|code)?|secret|token|api[-_ ]?key|credential|bearer|otp|one[-_ ]?time|verification|auth|session|cookie|private[-_ ]?key|seed[-_ ]?phrase|mnemonic|pin(?![a-z])|cvv|iban|ssn/i;

/** Shapes that look like a secret even without a telling word. */
const SECRET_SHAPES = [
  /\d{4,}/, // OTPs, card fragments, account numbers
  /[A-Za-z0-9_-]{16,}/, // opaque tokens and hashes
  /[A-Za-z0-9+/]{12,}={0,2}/, // base64-ish blobs
  /[\w.+-]+@[\w-]+\.[\w.]+/, // addresses
  /(?:\d{1,3}\.){3}\d{1,3}/, // addresses of the other sort
];

/**
 * Decide whether a visible string may be shown to the model.
 *
 * Fail-closed by construction: a string is disclosed only when it is short,
 * word-shaped, drawn from a restricted character set, free of credential words
 * and free of secret-looking runs. Anything else returns undefined and the
 * region is masked with its role alone.
 *
 * This is deliberately conservative. It will withhold plenty of harmless text.
 * That is the correct direction to be wrong in: a withheld label costs the
 * model some context, a disclosed credential costs the user their account.
 */
export function disclosableText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > COMPUTER_TEXT_MAX_CHARS) return undefined;
  // Restricted, printable, non-controlling character set.
  if (!/^[\p{L}\p{N} .,:;!?'’"()[\]{}/&%+*#@=<>|~^$-]+$/u.test(text)) return undefined;
  if (text.split(' ').filter(Boolean).length > COMPUTER_TEXT_MAX_WORDS) return undefined;
  if (SENSITIVE_WORDS.test(text)) return undefined;
  if (SECRET_SHAPES.some((shape) => shape.test(text))) return undefined;
  return text;
}

export interface ComputerScreenshot {
  screenshot: string;
  width: number;
  height: number;
  layout?: ComputerRedactionLayout;
}

export interface ScreenshotRedactor {
  redact(input: {
    readonly image: ComputerScreenshot;
    readonly binding: Readonly<ComputerSessionBinding>;
    readonly observationId: string;
    readonly signal: AbortSignal;
  }): Promise<{
    observation: ComputerModelObservation;
    metadata: { method: string; maskedRegions: number; sensitiveControls: number };
  }>;
}

export type ComputerVisionOutcome =
  | 'COMPLETED'
  | 'WAITING_APPROVAL'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'FAILED'
  | 'UNKNOWN'
  | 'LIMIT_REACHED';
export interface ComputerVisionResult {
  outcome: ComputerVisionOutcome;
  iterations: number;
  screenshots: number;
  modelRequests: number;
  actions: number;
  approvalId?: string;
  sessionId?: string;
  observationId?: string;
}

export interface ComputerSessionBinding {
  userId: string;
  workspaceId: string;
  executionTaskId: string;
  sessionId: string;
}

/** Model output is a proposal, never an authorization or an actuator handle. */
export interface ComputerActionProposer {
  readonly metadata: { readonly provider: string; readonly model: string };
  propose(request: ComputerModelRequest): Promise<ComputerActionProposal>;
}

export interface ComputerModelObservation {
  readonly screenshot: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly untrusted: true;
  /** Attestation by the trusted observation redactor, never by the model. */
  readonly disclosure: 'redacted';
}

export interface ComputerModelRequest {
  readonly observation: ComputerModelObservation;
  readonly signal: AbortSignal;
}

export type ComputerModelFailure =
  'CANCELLED' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_OBSERVATION' | 'INVALID_RESPONSE';

export class ComputerModelError extends Error {
  constructor(readonly code: ComputerModelFailure) {
    super(`Computer model unavailable or invalid response (${code})`);
    this.name = 'ComputerModelError';
  }
}

export interface ComputerActionProposal extends ComputerAction {
  readonly type: ComputerModelActionType;
  readonly viewport: { readonly width: number; readonly height: number };
}

export type ComputerModelActionType =
  | 'screenshot'
  | 'mouseMove'
  | 'click'
  | 'doubleClick'
  | 'mouseDown'
  | 'mouseUp'
  | 'scroll'
  | 'keyPress'
  | 'typeText'
  | 'hotkey';

export const COMPUTER_VIEWPORT = { width: 1280, height: 800 } as const;
export const COMPUTER_MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

export function validateComputerPoint(x: unknown, y: unknown): asserts x is number {
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= COMPUTER_VIEWPORT.width ||
    y >= COMPUTER_VIEWPORT.height
  ) {
    throw new Error('Coordinates outside computer viewport');
  }
}

export const COMPUTER_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
] as const;
export const COMPUTER_HOTKEYS = ['Control+A', 'Control+Z', 'Control+Shift+Z', 'Shift+Tab'] as const;
