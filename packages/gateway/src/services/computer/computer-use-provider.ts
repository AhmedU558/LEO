import type {
  ComputerUseProvider,
  ComputerSessionBinding,
  ComputerAction,
  ComputerScreenshot,
} from '@ownpilot/core/computer';
import { getBrowserService } from '../browser-service.js';
import { PuppeteerBrowserProvider } from './puppeteer-provider.js';
import type { ExecutionTaskContext } from '../execution-task-context.js';

/** Uses the existing isolated BrowserContext and its network protections. */
export class PuppeteerComputerUseProvider
  extends PuppeteerBrowserProvider
  implements ComputerUseProvider
{
  private closed = false;
  private initialized = false;
  constructor(
    ctx: ExecutionTaskContext,
    private binding: ComputerSessionBinding
  ) {
    super(ctx, binding.sessionId);
    if (
      !binding.sessionId ||
      !binding.userId ||
      !binding.workspaceId ||
      !binding.executionTaskId ||
      ctx.userId !== binding.userId ||
      ctx.workspaceId !== binding.workspaceId ||
      ctx.taskId !== binding.executionTaskId
    )
      throw new Error('Computer provider binding mismatch');
    this.binding = Object.freeze({ ...binding });
  }
  async initialize(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error('Closed computer provider');
    if (!this.initialized) {
      await getBrowserService().initializeComputerSession(this.binding);
      if (this.closed || signal.aborted) {
        await getBrowserService().closePage(this.binding.sessionId);
        throw new Error('Computer initialization cancelled');
      }
      this.initialized = true;
    }
    this.assertOpen();
  }
  private assertOpen() {
    if (this.closed || !this.initialized || !getBrowserService().hasComputerSession(this.binding))
      throw new Error('Closed or stale computer provider');
  }
  override async navigate(url: string) {
    this.assertOpen();
    return super.navigate(url);
  }
  override async executeAction(action: ComputerAction) {
    this.assertOpen();
    return super.executeAction(action);
  }
  override async getState() {
    this.assertOpen();
    const shot = await this.screenshot();
    const tree = await getBrowserService().accessibilityTree(this.binding.sessionId);
    return { screenshotBase64: shot.screenshot, accessibilityTree: tree.tree };
  }
  private async input(type: string, params: Record<string, unknown> = {}) {
    this.assertOpen();
    return getBrowserService().computerInput(this.binding, type, params);
  }
  async screenshot() {
    const before = await this.inspectForRedaction();
    const shot = (await this.input('screenshot')) as ComputerScreenshot;
    const after = await this.inspectForRedaction();
    if (before.revision !== after.revision) throw new Error('Page changed during capture');
    return { ...shot, layout: after };
  }
  async inspectForRedaction() {
    this.assertOpen();
    return getBrowserService().computerRedactionLayout(this.binding);
  }
  async mouseMove(x: number, y: number) {
    await this.input('mouseMove', { x, y });
  }
  async click(x: number, y: number) {
    await this.input('click', { x, y });
  }
  async doubleClick(x: number, y: number) {
    await this.input('doubleClick', { x, y });
  }
  async mouseDown(x: number, y: number) {
    await this.input('mouseDown', { x, y });
  }
  async mouseUp(x: number, y: number) {
    await this.input('mouseUp', { x, y });
  }
  async scroll(deltaX: number, deltaY: number) {
    await this.input('scroll', { deltaX, deltaY });
  }
  async keyPress(key: string) {
    await this.input('keyPress', { key });
  }
  async typeText(text: string) {
    await this.input('typeText', { text });
  }
  async hotkey(keys: readonly string[]) {
    await this.input('hotkey', { keys });
  }
  async cancel() {
    await this.close();
  }
  override async close() {
    this.closed = true;
    await getBrowserService().closeComputerSession(this.binding);
  }
}
