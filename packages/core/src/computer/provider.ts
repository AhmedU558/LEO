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
  screenshot(): Promise<{ screenshot: string; width: number; height: number }>;
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

export interface ComputerSessionBinding {
  userId: string;
  workspaceId: string;
  executionTaskId: string;
  sessionId: string;
}

/** Model output is a proposal, never an authorization or an actuator handle. */
export interface ComputerActionProposer {
  propose(observation: {
    screenshot: string;
    viewport: { width: number; height: number };
    untrusted: true;
  }): Promise<ComputerAction>;
}

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
