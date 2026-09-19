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
  /**
   * Executes a system-level action (shell command, file operation, app control)
   */
  executeAction(action: ComputerAction): Promise<ComputerActionResult>;

  /**
   * Captures the entire system screen state
   */
  getScreenState(): Promise<{ screenshotBase64: string }>;

  /**
   * Cleans up computer use resources
   */
  cleanup(): Promise<void>;
}
