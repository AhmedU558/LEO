/// <reference lib="dom" />
/**
 * Browser Service
 *
 * Headless browser automation via puppeteer-core.
 * Manages browser instance, page sessions per user, URL allowlist,
 * and PII-aware form filling.
 */

import { existsSync } from 'node:fs';
import type { Browser, Page, SerializedAXNode, BrowserContext } from 'puppeteer-core';
import { hasPII, detectPII } from '@ownpilot/core/privacy';
import { getLog, getConfigCenter } from '@ownpilot/core/services';
import { isBlockedUrl, isPrivateUrlAsync } from '../utils/ssrf.js';
import { PolicyEngine } from '@ownpilot/core/security';
import type { ComputerSessionBinding } from '@ownpilot/core/computer';
import {
  COMPUTER_VIEWPORT,
  COMPUTER_MAX_SCREENSHOT_BYTES,
  COMPUTER_KEYS,
  COMPUTER_HOTKEYS,
  validateComputerPoint,
} from '@ownpilot/core/computer';

const log = getLog('BrowserService');

import {
  BROWSER_MAX_PAGES,
  BROWSER_SESSION_TIMEOUT_MS,
  BROWSER_CLEANUP_INTERVAL_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_MAX_TEXT_LENGTH,
} from '../config/defaults.js';

const BROWSER_SERVICE = 'browser_service';
const MAX_PAGES_PER_USER = BROWSER_MAX_PAGES;
const SESSION_TIMEOUT_MS = BROWSER_SESSION_TIMEOUT_MS;
const CLEANUP_INTERVAL_MS = BROWSER_CLEANUP_INTERVAL_MS;
const DEFAULT_NAVIGATION_TIMEOUT = BROWSER_NAVIGATION_TIMEOUT_MS;
const DEFAULT_ACTION_TIMEOUT = BROWSER_ACTION_TIMEOUT_MS;
const MAX_TEXT_LENGTH = BROWSER_MAX_TEXT_LENGTH;

/** Total navigation attempts (1 initial + retries) for transient network faults. */
const MAX_NAV_ATTEMPTS = 2;
/** Base backoff between navigation retries; multiplied by the attempt number. */
const NAV_RETRY_DELAY_MS = 400;

/**
 * Chromium navigation faults that are typically transient â€” a connection reset,
 * a dropped socket, a network change, or a timeout â€” where an immediate retry
 * usually succeeds. Permanent faults (ERR_NAME_NOT_RESOLVED / DNS, ERR_ABORTED,
 * invalid URL, SSRF blocks) are deliberately excluded so they fail fast instead
 * of wasting a retry. Exported for direct unit testing.
 */
const RETRYABLE_NAV_ERROR =
  /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_FAILED|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_SOCKET_NOT_CONNECTED|Navigation timeout|timeout exceeded/i;

export function isRetryableNavError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || RETRYABLE_NAV_ERROR.test(err.message);
}

/** Render a serialized accessibility node into a compact indented outline. */
/**
 * Render one accessibility node (and its subtree) as a compact indented line.
 *
 * Beyond role/name/value we surface the accessibility STATE flags so an agent
 * can pick the right action without a probe-and-fail cycle: it should not click
 * a `[disabled]` control, should not re-check an already `[checked]` box, and
 * should expand a `[collapsed]` section before looking inside it. Puppeteer only
 * populates each flag for roles where it applies (interestingOnly snapshot), so
 * emitting them is safe and adds no noise for elements that don't support them.
 * Exported for unit testing.
 */
export function renderAxNode(node: SerializedAXNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const parts: string[] = [node.role];
  if (node.name) parts.push(`"${node.name}"`);
  if (node.value !== undefined && node.value !== '') parts.push(`= ${String(node.value)}`);

  const flags: string[] = [];
  if (node.disabled) flags.push('disabled');
  if (node.checked === 'mixed') flags.push('mixed');
  else if (node.checked === true) flags.push('checked');
  if (node.pressed === 'mixed') flags.push('pressed:mixed');
  else if (node.pressed === true) flags.push('pressed');
  if (node.selected) flags.push('selected');
  if (node.expanded === true) flags.push('expanded');
  else if (node.expanded === false) flags.push('collapsed');
  if (node.required) flags.push('required');
  if (node.readonly) flags.push('readonly');
  if (node.invalid && node.invalid !== 'false') flags.push('invalid');
  if (node.focused) flags.push('focused');
  if (flags.length) parts.push(`[${flags.join(' ')}]`);

  // Heading depth helps the agent reconstruct document structure.
  if (node.role === 'heading' && node.level) parts.push(`(h${node.level})`);

  let line = `${indent}- ${parts.join(' ')}`;
  if (node.children?.length) {
    line += `\n${node.children.map((child) => renderAxNode(child, depth + 1)).join('\n')}`;
  }
  return line;
}

/** Accessibility roles an agent can act on â€” used to build a recovery hint. */
const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'tab',
  'searchbox',
  'switch',
  'listbox',
  'option',
  'slider',
]);

/**
 * Build a short list of the actionable elements actually on the page, for when a
 * selector is not found. Reuses the accessibility tree so the agent can re-target
 * by visible text instead of blindly guessing another CSS selector. Bounded to 15.
 * Exported for unit testing.
 */
export async function buildActionableElementsHint(page: Page): Promise<string> {
  try {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
    if (!snapshot) return ' Call browser_accessibility_tree to inspect the page structure.';
    const found: string[] = [];
    const walk = (node: SerializedAXNode): void => {
      if (found.length >= 15) return;
      if (ACTIONABLE_ROLES.has(node.role)) {
        found.push(node.name ? `${node.role} "${node.name}"` : node.role);
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(snapshot);
    return found.length > 0
      ? ` Actionable elements found: ${found.join(', ')}. ` +
          'Use browser_accessibility_tree for the full structure and target by visible text.'
      : ' Call browser_accessibility_tree to inspect the page structure.';
  } catch {
    return ' Call browser_accessibility_tree to inspect the page structure.';
  }
}

/**
 * waitForSelector that, on timeout (selector never appeared), throws an error
 * naming the actionable elements that ARE present â€” turning a dead-end "not
 * found" into a self-correction cue. Non-timeout errors pass through unchanged.
 * Exported for unit testing.
 */
export async function waitForSelectorWithHint(
  page: Page,
  selector: string,
  timeout: number
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || /waiting for selector|timeout/i.test(err.message));
    if (!isTimeout) throw err;
    const hint = await buildActionableElementsHint(page);
    throw new Error(`Selector "${selector}" not found after ${timeout}ms.${hint}`);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'wait' | 'scroll' | 'select';
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  timeout?: number;
}

export interface FormField {
  selector: string;
  value: string;
}

interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
}

interface BrowserConfigInfo {
  available: boolean;
  executablePath: string | null;
  allowedDomains: string[];
  maxPagesPerUser: number;
}

interface PageSession {
  page: Page;
  context: BrowserContext;
  userId: string;
  createdAt: number;
  lastActivity: number;
}

// ============================================================================
// Service
// ============================================================================

export class BrowserService {
  private browser: Browser | null = null;
  private browserLaunch: Promise<Browser> | null = null;
  private sessions = new Map<string, PageSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  // --------------------------------------------------------------------------
  // Availability
  // --------------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    const execPath = this.findExecutablePath();
    return execPath !== null;
  }

  async getConfig(): Promise<BrowserConfigInfo> {
    const execPath = this.findExecutablePath();
    return {
      available: execPath !== null,
      executablePath: execPath,
      allowedDomains: this.getAllowedDomains(),
      maxPagesPerUser: MAX_PAGES_PER_USER,
    };
  }

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  async navigate(
    sessionId: string,
    userId: string,
    url: string
  ): Promise<{ url: string; title: string; text: string }> {
    await this.validateUrl(url, sessionId);
    const page = await this.getOrCreatePage(sessionId, userId);

    // Two-phase load. Pages with long-lived connections (analytics beacons,
    // websockets, SSE, ad trackers) never reach network-idle, so waiting on
    // `networkidle2` for the whole navigation times out and aborts the task even
    // though the page is fully usable. Instead: (1) require DOM-ready, which is
    // the real precondition for reading/acting on the page and surfaces genuine
    // navigation errors (DNS, connection refused, HTTP abort); (2) then settle
    // the network best-effort with a short budget, swallowing only a timeout so a
    // chatty page does not fail the whole navigation.
    // Retry the DOM-ready load on transient network faults (reset socket,
    // dropped connection, timeout). Permanent faults (DNS, SSRF, invalid URL)
    // are not retryable and throw on the first attempt.
    for (let attempt = 1; ; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: DEFAULT_NAVIGATION_TIMEOUT,
        });
        break;
      } catch (err) {
        if (attempt < MAX_NAV_ATTEMPTS && isRetryableNavError(err)) {
          await new Promise((r) => setTimeout(r, NAV_RETRY_DELAY_MS * attempt));
          continue;
        }
        throw err;
      }
    }

    try {
      await page.waitForNetworkIdle({
        idleTime: 500,
        timeout: Math.min(DEFAULT_ACTION_TIMEOUT, 5000),
      });
    } catch (err) {
      // Only tolerate the idle wait timing out â€” anything else is a real fault.
      if (!(err instanceof Error && /timeout|timed out|waiting for/i.test(err.message))) {
        throw err;
      }
    }

    const title = await page.title();
    const text = await this.getPageText(page);

    return { url: page.url(), title, text };
  }

  // --------------------------------------------------------------------------
  // Click
  // --------------------------------------------------------------------------

  async click(sessionId: string, selector: string): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    await waitForSelectorWithHint(page, selector, DEFAULT_ACTION_TIMEOUT);
    await page.click(selector);
    // Wait briefly for any navigation or DOM changes
    await new Promise((r) => setTimeout(r, 500));
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Back navigation
  // --------------------------------------------------------------------------

  /**
   * Go back one entry in the page history. The single most common need after
   * clicking into a detail/article page: return to the list to continue. Returns
   * `navigated: false` when there is no history to go back to (the agent then
   * knows to navigate by URL instead of assuming it moved).
   */

  async goForward(sessionId: string): Promise<{ url: string; title: string; navigated: boolean }> {
    const page = await this.getExistingPage(sessionId);
    const response = await page.goForward({
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT,
    });
    return { url: page.url(), title: await page.title(), navigated: response !== null };
  }

  async reload(sessionId: string): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT,
    });
    return { url: page.url(), title: await page.title() };
  }

  async goBack(sessionId: string): Promise<{ url: string; title: string; navigated: boolean }> {
    const page = await this.getExistingPage(sessionId);
    const response = await page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT,
    });
    return { url: page.url(), title: await page.title(), navigated: response !== null };
  }

  // --------------------------------------------------------------------------
  // Hover
  // --------------------------------------------------------------------------

  /**
   * Hover the pointer over an element â€” reveals dropdown menus, tooltips, and
   * hover-gated controls that must be visible before they can be clicked.
   */
  async hover(sessionId: string, selector: string): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    await waitForSelectorWithHint(page, selector, DEFAULT_ACTION_TIMEOUT);
    await page.hover(selector);
    // Brief settle so any hover-triggered menu/animation can render.
    await new Promise((r) => setTimeout(r, 300));
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Type
  // --------------------------------------------------------------------------

  async type(
    sessionId: string,
    selector: string,
    text: string
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    await waitForSelectorWithHint(page, selector, DEFAULT_ACTION_TIMEOUT);
    // Clear existing value first
    await page.click(selector, { count: 3 });
    await page.type(selector, text);
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Fill Form (PII-aware)
  // --------------------------------------------------------------------------

  async fillForm(
    sessionId: string,
    fields: FormField[]
  ): Promise<{ url: string; title: string; piiWarnings: string[] }> {
    const page = await this.getExistingPage(sessionId);
    const piiWarnings: string[] = [];

    for (const field of fields) {
      // Check for PII in field values
      if (hasPII(field.value)) {
        const detection = detectPII(field.value);
        const categories = detection.matches.map((m) => m.category).join(', ');
        piiWarnings.push(
          `Field "${field.selector}" contains potential PII (${categories}). Value was still filled.`
        );
      }

      await waitForSelectorWithHint(page, field.selector, DEFAULT_ACTION_TIMEOUT);
      await page.click(field.selector, { count: 3 });
      await page.type(field.selector, field.value);
    }

    return {
      url: page.url(),
      title: await page.title(),
      piiWarnings,
    };
  }

  // --------------------------------------------------------------------------
  // Screenshot
  // --------------------------------------------------------------------------

  async screenshot(
    sessionId: string,
    opts?: ScreenshotOptions
  ): Promise<{ screenshot: string; url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    let buffer: Uint8Array;

    if (opts?.selector) {
      const element = await page.waitForSelector(opts.selector, {
        timeout: DEFAULT_ACTION_TIMEOUT,
      });
      if (!element) throw new Error(`Element not found: ${opts.selector}`);
      buffer = await element.screenshot({ type: 'png' });
    } else {
      buffer = await page.screenshot({
        type: 'png',
        fullPage: opts?.fullPage ?? false,
      });
    }

    return {
      screenshot: Buffer.from(buffer).toString('base64'),
      url: page.url(),
      title: await page.title(),
    };
  }

  // --------------------------------------------------------------------------
  // Extract Text
  // --------------------------------------------------------------------------

  async find(
    sessionId: string,
    textOrSelector: string
  ): Promise<{ url: string; title: string; matches: string[] }> {
    const page = await this.getExistingPage(sessionId);
    const matches = await page.evaluate((query) => {
      const results: string[] = [];
      try {
        const elements = document.querySelectorAll(query);
        if (elements.length > 0) {
          elements.forEach((el) => results.push((el as HTMLElement).innerText || ''));
          return results.slice(0, 50);
        }
      } catch {}

      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walk.nextNode())) {
        if (n.textContent && n.textContent.includes(query)) {
          const parent = n.parentElement;
          if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
            results.push(parent.innerText || n.textContent);
          }
        }
      }
      return Array.from(new Set(results)).slice(0, 50);
    }, textOrSelector);
    return { url: page.url(), title: await page.title(), matches };
  }

  async extractText(
    sessionId: string,
    selector?: string
  ): Promise<{ text: string; url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);

    let text: string;
    if (selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
      text = await page.$eval(selector, (el) => el.textContent ?? '');
    } else {
      text = await this.getPageText(page);
    }

    return {
      text: text.substring(0, MAX_TEXT_LENGTH),
      url: page.url(),
      title: await page.title(),
    };
  }

  // --------------------------------------------------------------------------
  // Extract Structured Data
  // --------------------------------------------------------------------------

  async extractData(
    sessionId: string,
    selectors: Record<string, string>
  ): Promise<{ data: Record<string, string>; url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    const data: Record<string, string> = {};

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        data[key] = await page.$eval(selector, (el) => el.textContent?.trim() ?? '');
      } catch {
        data[key] = '';
      }
    }

    return { data, url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Accessibility Tree
  //
  // Returns the page as a structured accessibility (a11y) outline â€” role + name
  // hierarchy â€” instead of raw HTML. This is the representation Hermes Agent
  // uses: far more compact and easier for an LLM to reason about and navigate
  // than DOM/HTML, since it surfaces the same elements assistive tech exposes.
  // --------------------------------------------------------------------------

  async accessibilityTree(
    sessionId: string,
    selector?: string
  ): Promise<{ tree: string; url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);

    // Type inferred from page.$ â€” avoids naming DOM lib types (Element/Node),
    // which aren't in the gateway tsconfig's lib set.
    let root = null as Awaited<ReturnType<typeof page.$>>;
    if (selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
      root = await page.$(selector);
    }

    const snapshot = await page.accessibility.snapshot({
      interestingOnly: true,
      root: root ?? undefined,
    });
    const tree = snapshot
      ? renderAxNode(snapshot, 0).substring(0, MAX_TEXT_LENGTH)
      : '(empty accessibility tree)';

    return { tree, url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Wait
  // --------------------------------------------------------------------------

  async wait(
    sessionId: string,
    selector?: string,
    timeout?: number
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    const ms = timeout ?? DEFAULT_ACTION_TIMEOUT;

    if (selector) {
      await page.waitForSelector(selector, { timeout: ms });
    } else {
      await new Promise((r) => setTimeout(r, Math.min(ms, 10_000)));
    }

    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Scroll
  // --------------------------------------------------------------------------

  async scroll(
    sessionId: string,
    direction: 'up' | 'down',
    pixels?: number
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    const amount = pixels ?? 500;
    const y = direction === 'down' ? amount : -amount;
    await page.mouse.wheel({ deltaY: y });
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Select
  // --------------------------------------------------------------------------

  async select(
    sessionId: string,
    selector: string,
    value: string
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    await waitForSelectorWithHint(page, selector, DEFAULT_ACTION_TIMEOUT);
    await page.select(selector, value);
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  /**
   * Press a single keyboard key on the active page. Maps directly to
   * Puppeteer's `keyboard.press`, which supports both single characters
   * ('a', 'A') and named keys (Enter, Tab, Escape, ArrowDown, â€¦).
   *
   * Critical for agent autonomy on real sites: many search bars submit
   * on Enter rather than via a button, and modal dialogs close on Esc.
   * Without this, agents could only type strings â€” not actually progress
   * through keyboard-driven UIs.
   *
   * `selector` is optional â€” when supplied, the element is focused first
   * so the key targets the right input. Without it, the key fires on
   * whatever currently has focus (useful for global shortcuts).
   */
  async pressKey(
    sessionId: string,
    key: string,
    selector?: string
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(sessionId);
    if (selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
      await page.focus(selector);
    }
    // Puppeteer's KeyInput type is a literal union of ~200 keys; we accept
    // a string from the LLM and forward it through. Invalid keys throw a
    // clear Puppeteer error which the executor wraps for the LLM.
    await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
    return { url: page.url(), title: await page.title() };
  }

  /**
   * Read the current page's URL + title without taking any action.
   *
   * Agents need this to verify that a previous click / form-submit
   * landed where they expected before proceeding. Returns null when the
   * user has no open page (instead of throwing â€” letting agents probe
   * cheaply without exception handling).
   */
  async getState(sessionId: string): Promise<{ url: string; title: string } | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    try {
      return { url: session.page.url(), title: await session.page.title() };
    } catch {
      return null;
    }
  }

  private computerBindings = new Map<string, ComputerSessionBinding>();

  private computerScope(binding: ComputerSessionBinding): string {
    return JSON.stringify([
      binding.userId,
      binding.workspaceId,
      binding.executionTaskId,
      binding.sessionId,
    ]);
  }

  hasComputerSession(binding: ComputerSessionBinding): boolean {
    const stored = this.computerBindings.get(binding.sessionId);
    return (
      !!stored &&
      this.computerScope(stored) === this.computerScope(binding) &&
      !!this.getPageInfo(binding.sessionId)?.active
    );
  }

  async closeComputerSession(binding: ComputerSessionBinding): Promise<void> {
    const stored = this.computerBindings.get(binding.sessionId);
    if (stored && this.computerScope(stored) === this.computerScope(binding))
      await this.closePage(binding.sessionId);
  }

  async initializeComputerSession(binding: ComputerSessionBinding): Promise<void> {
    const { sessionId, userId } = binding;
    if (!sessionId || !userId || !binding.workspaceId || !binding.executionTaskId)
      throw new Error('Missing computer session scope');
    const scope = this.computerScope(binding);
    const bound = this.computerBindings.get(sessionId);
    if (bound && this.computerScope(bound) !== scope)
      throw new Error('Computer session scope mismatch');
    const existing = this.sessions.get(sessionId);
    if (existing && (!bound || existing.userId !== userId))
      throw new Error('Computer session owner mismatch');
    this.computerBindings.set(sessionId, Object.freeze({ ...binding }));
    try {
      const page = await this.getOrCreatePage(sessionId, userId);
      await page.setViewport(COMPUTER_VIEWPORT);
      const guard = await page.browser().target().createCDPSession();
      page.once('close', () => {
        void guard.detach().catch(() => log.warn('Browser target guard cleanup failed'));
      });
      guard.on('Target.attachedToTarget', ({ targetInfo, sessionId: attachedId }) => {
        if (targetInfo.openerId) {
          // Deny requests before resuming: closing a paused popup can deadlock its opener's input.
          const popup = guard.connection()?.session(attachedId);
          void (async () => {
            if (popup) {
              popup.on('Fetch.requestPaused', ({ requestId }) => {
                void popup
                  .send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
                  .catch(() => log.warn('Popup request cleanup failed'));
              });
              await popup.send('Fetch.enable', {
                patterns: [{ urlPattern: '*', requestStage: 'Request' }],
              });
              await popup.send('Runtime.runIfWaitingForDebugger');
            }
            await guard.send('Target.closeTarget', { targetId: targetInfo.targetId });
          })().catch(() => log.warn('Popup target cleanup failed'));
        } else {
          void guard
            .connection()
            ?.session(attachedId)
            ?.send('Runtime.runIfWaitingForDebugger')
            .catch(() => log.warn('Browser target activation failed'));
        }
      });
      await guard.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: 'page', exclude: false }, { exclude: true }],
      });
      // New windows are never adopted as another computer session.
      page.on('popup', (popup) => {
        void popup?.close().catch(() => log.warn('Browser resource cleanup failed'));
      });
    } catch (error) {
      await this.closePage(sessionId);
      throw error;
    }
  }

  /** Fixed browser primitives only: no scripts, host input or clipboard permissions. */
  async computerInput(
    binding: ComputerSessionBinding,
    type: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const { sessionId, userId } = binding;
    if (!this.hasComputerSession(binding)) throw new Error('Computer session scope mismatch');
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId || session.page.isClosed())
      throw new Error('Closed or stale computer session');
    const page = session.page;
    const viewport = page.viewport();
    if (
      !viewport ||
      viewport.width !== COMPUTER_VIEWPORT.width ||
      viewport.height !== COMPUTER_VIEWPORT.height
    )
      throw new Error('Computer viewport changed');
    session.lastActivity = Date.now();
    if (['mouseMove', 'click', 'doubleClick', 'mouseDown', 'mouseUp'].includes(type)) {
      validateComputerPoint(params.x, params.y);
      const x = params.x,
        y = params.y as number;
      await page.mouse.move(x, y);
      if (type === 'click' || type === 'doubleClick')
        await page.mouse.click(x, y, { count: type === 'doubleClick' ? 2 : 1 });
      if (type === 'mouseDown') await page.mouse.down();
      if (type === 'mouseUp') await page.mouse.up();
    } else if (type === 'scroll') {
      const { deltaX, deltaY } = params;
      if (
        typeof deltaX !== 'number' ||
        typeof deltaY !== 'number' ||
        !Number.isFinite(deltaX) ||
        !Number.isFinite(deltaY) ||
        Math.abs(deltaX) > 1280 ||
        Math.abs(deltaY) > 800
      )
        throw new Error('Invalid computer scroll');
      await page.mouse.wheel({ deltaX, deltaY });
    } else if (type === 'keyPress') {
      if (!COMPUTER_KEYS.some((key) => key === params.key))
        throw new Error('Unsupported computer key');
      await page.keyboard.press(params.key as (typeof COMPUTER_KEYS)[number]);
    } else if (type === 'typeText') {
      if (typeof params.text !== 'string' || params.text.length > MAX_TEXT_LENGTH)
        throw new Error('Invalid computer text');
      await page.keyboard.type(params.text);
    } else if (type === 'hotkey') {
      if (
        !Array.isArray(params.keys) ||
        !COMPUTER_HOTKEYS.some((key) => key === (params.keys as unknown[]).join('+'))
      )
        throw new Error('Unsupported computer hotkey');
      const keys = params.keys as Parameters<typeof page.keyboard.down>[0][];
      try {
        for (const key of keys) await page.keyboard.down(key);
      } finally {
        for (const key of [...keys].reverse()) await page.keyboard.up(key);
      }
    } else if (type === 'screenshot') {
      const bytes = await page.screenshot({
        type: 'png',
        fullPage: false,
        captureBeyondViewport: false,
      });
      if (bytes.byteLength > COMPUTER_MAX_SCREENSHOT_BYTES)
        throw new Error('Computer screenshot exceeds byte limit');
      return { screenshot: Buffer.from(bytes).toString('base64'), ...COMPUTER_VIEWPORT };
    } else throw new Error('Unsupported computer input');
    return undefined;
  }

  async closePage(sessionId: string): Promise<boolean> {
    this.computerBindings.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      await session.page.close();
    } catch {
      // Page may already be closed
    } finally {
      await session.context.close().catch(() => log.warn('Browser resource cleanup failed'));
    }
    this.sessions.delete(sessionId);
    return true;
  }

  getPageInfo(sessionId: string): { url: string; active: boolean } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { url: session.page.url(), active: !session.page.isClosed() };
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [_userId, session] of this.sessions) {
      try {
        await session.page.close();
        await session.context.close();
      } catch {
        // Ignore
      }
    }
    this.sessions.clear();
    this.computerBindings.clear();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }
  }

  // --------------------------------------------------------------------------
  // Internal: Page Management
  // --------------------------------------------------------------------------

  private async getOrCreatePage(sessionId: string, userId: string): Promise<Page> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing.page;
    }

    // Check page limit
    const userPageCount = [...this.sessions.values()].filter((s) => s.userId === userId).length;
    if (userPageCount >= MAX_PAGES_PER_USER) {
      throw new Error(`Maximum ${MAX_PAGES_PER_USER} browser pages per user`);
    }

    const browser = await this.ensureBrowser();
    const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'deny' } });
    try {
      const page = await context.newPage();

      // Set reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Block unnecessary resource types and SSRF targets
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        const type = req.resourceType();
        if (type === 'media' || type === 'font') {
          req.abort();
          return;
        }

        // SSRF protection and domain allowlist for all subresources and redirects
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          req.continue();
          return;
        }
        try {
          await this.validateUrl(url, sessionId);
          req.continue();
        } catch {
          log.warn('Aborting browser request due to policy/SSRF');
          req.abort();
        }
      });

      const session: PageSession = {
        page,
        context,
        userId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(sessionId, session);

      return page;
    } catch (error) {
      await context.close().catch(() => log.warn('Browser resource cleanup failed'));
      throw error;
    }
  }

  private async getExistingPage(sessionId: string): Promise<Page> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('No active browser session. Use browse_web to navigate to a page first.');
    }
    session.lastActivity = Date.now();
    return session.page;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    // Single-flight: concurrent cold-starts must share ONE launch. Without
    // this, two overlapping callers both pass the connected check while
    // this.browser is still null and both launch â€” the loser's assignment is
    // overwritten, orphaning a Chromium instance that is never closed, while
    // its 'disconnected' handler stays registered on `this` and later evicts
    // the LIVE browser's sessions (round 71).
    if (!this.browserLaunch) {
      this.browserLaunch = this.launchBrowser().finally(() => {
        this.browserLaunch = null;
      });
    }
    return this.browserLaunch;
  }

  private async launchBrowser(): Promise<Browser> {
    const execPath = this.findExecutablePath();
    if (!execPath) {
      throw new Error(
        'Browser not available. Install Chrome/Chromium or set PUPPETEER_EXECUTABLE_PATH.'
      );
    }

    const puppeteer = await import('puppeteer-core');
    const browser = await puppeteer.default.launch({
      executablePath: execPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
      ],
    });

    browser.on('disconnected', () => {
      log.info('Browser disconnected');
      this.browser = null;
      this.sessions.clear();
      this.computerBindings.clear();
    });

    log.info('Browser launched', { executablePath: execPath });
    this.browser = browser;
    return browser;
  }

  // --------------------------------------------------------------------------
  // Internal: Page Text Extraction
  // --------------------------------------------------------------------------

  private async getPageText(page: Page): Promise<string> {
    const text: string = await page.$eval('body', (el) => {
      const innerText = (el as { innerText?: unknown }).innerText;
      return typeof innerText === 'string' ? innerText : (el.textContent ?? '');
    });
    return text.substring(0, MAX_TEXT_LENGTH);
  }

  // --------------------------------------------------------------------------
  // Internal: URL Validation
  // --------------------------------------------------------------------------

  private async validateUrl(url: string, sessionId: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Only HTTP/HTTPS URLs are allowed. Got: ${parsed.protocol}`);
    }

    if (isBlockedUrl(url)) {
      throw new Error('URL targets a blocked or private network address.');
    }

    // DNS-rebinding protection: check resolved IPs before navigation
    if (await isPrivateUrlAsync(url)) {
      throw new Error('URL resolves to a private or blocked network address.');
    }

    const parsedSession = this.parseSessionId(sessionId);
    const policyEngine = new PolicyEngine();
    const policyResult = policyEngine.evaluate({
      identity: {
        userId: parsedSession.userId || 'system',
        workspaceId: parsedSession.workspaceId || 'system',
        roles: [],
      },
      action: 'browse_web',
      resource: url || '',
      capability: 'browser.navigate',
      risk: 'LOW',
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      autonomous: false,
      requestedParameters: { url },
    });
    if (policyResult.decision === 'DENY') {
      throw new Error(`Domain policy denied navigation to ${url}: ${policyResult.reason}`);
    }

    const allowedDomains = this.getAllowedDomains();
    if (allowedDomains.length > 0) {
      const hostname = parsed.hostname.toLowerCase();
      const allowed = allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
      if (!allowed) {
        throw new Error(
          `Domain "${hostname}" is not in the allowed domains list. ` +
            `Allowed: ${allowedDomains.join(', ')}`
        );
      }
    }
  }

  private parseSessionId(sessionId: string) {
    const binding = this.computerBindings.get(sessionId);
    if (binding)
      return {
        userId: binding.userId,
        workspaceId: binding.workspaceId,
        executionId: binding.executionTaskId,
      };
    const parts = sessionId.split(':');
    if (parts.length >= 3) {
      return { userId: parts[0], workspaceId: parts[1], executionId: parts[2] };
    }
    return { userId: sessionId, workspaceId: 'default', executionId: 'default' };
  }

  private getAllowedDomains(): string[] {
    try {
      const raw = getConfigCenter().getFieldValue(BROWSER_SERVICE, 'allowed_domains') as
        string | undefined;
      if (!raw) return [];
      return raw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Internal: Chrome Discovery
  // --------------------------------------------------------------------------

  private findExecutablePath(): string | null {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath) return envPath;

    const platform = process.platform;
    const candidates: string[] = [];

    if (platform === 'win32') {
      candidates.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      );
    } else if (platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      );
    } else {
      candidates.push(
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome'
      );
    }

    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // Skip
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Internal: Cleanup
  // --------------------------------------------------------------------------

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        log.debug('Closing stale browser session', { sessionId });
        try {
          await session.page.close();
          await session.context.close();
        } catch {
          // Ignore
        }
        this.sessions.delete(sessionId);
      }
    }

    if (this.sessions.size === 0 && this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BrowserService | null = null;

export function getBrowserService(): BrowserService {
  if (!instance) instance = new BrowserService();
  return instance;
}

/**
 * Stop and null the singleton. Call during shutdown or reset.
 */
export function resetBrowserService(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
