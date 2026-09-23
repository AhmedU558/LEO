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

export interface ComputerRedactionLayout {
  readonly revision: string;
  readonly controls: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
    kind: 'Button' | 'Link' | 'Field' | 'Password' | 'Secret' | 'Authentication' | 'Select';
  }[];
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
