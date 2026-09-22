import type {
  BrowserProvider,
  ComputerAction,
  ComputerActionResult,
} from '@ownpilot/core/computer';
import { getBrowserService } from '../browser-service.js';
import type { ExecutionTaskContext } from '../execution-task-context.js';

export class PuppeteerBrowserProvider implements BrowserProvider {
  constructor(private ctx: ExecutionTaskContext) {}

  private get sessionId() {
    return `${this.ctx.userId}:${this.ctx.workspaceId}:${this.ctx.taskId}`;
  }

  async navigate(url: string): Promise<ComputerActionResult> {
    try {
      const service = getBrowserService();
      const result = await service.navigate(this.sessionId, this.ctx.userId, url);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async executeAction(action: ComputerAction): Promise<ComputerActionResult> {
    try {
      const service = getBrowserService();
      let data: unknown;

      switch (action.type) {
        case 'click':
          data = await service.click(this.sessionId, action.params.selector as string);
          break;
        case 'type':
          data = await service.type(
            this.sessionId,
            action.params.selector as string,
            action.params.text as string
          );
          break;
        case 'hover':
          data = await service.hover(this.sessionId, action.params.selector as string);
          break;
        case 'scroll':
          data = await service.scroll(
            this.sessionId,
            action.params.direction as 'up' | 'down',
            action.params.pixels as number | undefined
          );
          break;

        case 'fill_form':
          data = await service.fillForm(
            this.sessionId,
            action.params.fields as { selector: string; value: string }[]
          );
          break;
        case 'screenshot':
          data = await service.screenshot(
            this.sessionId,
            action.params as { fullPage?: boolean; selector?: string }
          );
          break;
        case 'extract':
          if (action.params.dataSelectors) {
            data = await service.extractData(
              this.sessionId,
              action.params.dataSelectors as Record<string, string>
            );
          } else {
            data = await service.extractText(
              this.sessionId,
              action.params.selector as string | undefined
            );
          }
          break;
        case 'wait':
          data = await service.wait(
            this.sessionId,
            action.params.selector as string | undefined,
            action.params.timeoutMs as number | undefined
          );
          break;
        case 'select':
          data = await service.select(
            this.sessionId,
            action.params.selector as string,
            action.params.value as string
          );
          break;

        case 'navigate_forward':
          data = await service.goForward(this.sessionId);
          break;
        case 'reload':
          data = await service.reload(this.sessionId);
          break;
        case 'find':
          data = await service.find(this.sessionId, action.params.query as string);
          break;
        case 'inspect_page':
          data = await service.accessibilityTree(
            this.sessionId,
            action.params.selector as string | undefined
          );
          break;
        case 'navigate_back':
          data = await service.goBack(this.sessionId);
          break;
        case 'press_key':
          data = await service.pressKey(
            this.sessionId,
            action.params.key as string,
            action.params.selector as string | undefined
          );
          break;
        case 'get_state':
          data = await service.getState(this.sessionId);
          break;
        case 'accessibility_tree':
          data = await service.accessibilityTree(
            this.sessionId,
            action.params.selector as string | undefined
          );
          break;
        default:
          return { success: false, error: `Unsupported browser action: ${action.type}` };
      }
      return { success: true, data };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async getState(): Promise<{ screenshotBase64: string; accessibilityTree: unknown }> {
    const service = getBrowserService();
    const screenshot = await service.screenshot(this.sessionId, { fullPage: false });
    const tree = await service.accessibilityTree(this.sessionId);
    return {
      screenshotBase64: screenshot.screenshot,
      accessibilityTree: tree.tree,
    };
  }

  async close(): Promise<void> {
    const service = getBrowserService();
    await service.closePage(this.sessionId);
  }
}
