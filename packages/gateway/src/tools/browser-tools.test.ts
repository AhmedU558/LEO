import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BROWSER_TOOLS, BROWSER_TOOL_NAMES, executeBrowserTool } from './browser-tools.js';
import { getBrowserService } from '../services/browser-service.js';
import { ComputerService } from '../services/computer/service.js';

vi.mock('../services/browser-service.js', () => ({
  getBrowserService: vi.fn(),
}));

vi.mock('../services/computer/service.js', () => ({
  ComputerService: vi.fn(),
}));

describe('browser-tools', () => {
  let mockComputerService: any;
  let mockBrowserService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockComputerService = {
      executeAction: vi.fn().mockResolvedValue({ success: true, data: { url: 'mock' } }),
    };
    vi.mocked(ComputerService).mockImplementation(function (this: any) {
      return mockComputerService;
    } as any);

    mockBrowserService = {
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(getBrowserService).mockReturnValue(mockBrowserService as any);
  });

  describe('exports', () => {
    it('exports definitions and names', () => {
      expect(BROWSER_TOOLS.length).toBeGreaterThan(0);
      expect(BROWSER_TOOL_NAMES.length).toEqual(BROWSER_TOOLS.length);
    });
  });

  describe('executeBrowserTool mapping', () => {
    const defaultCtx = { workspaceDir: 'ws', conversationId: 'conv' };

    it('maps browse_web', async () => {
      await executeBrowserTool('browse_web', { url: 'https://example.com' }, 'user', defaultCtx);
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'navigate',
        params: { url: 'https://example.com' },
      });
    });

    it('maps browser_click', async () => {
      await executeBrowserTool('browser_click', { selector: '#btn' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'click',
        params: { selector: '#btn' },
      });
    });

    it('maps browser_type', async () => {
      await executeBrowserTool('browser_type', { selector: '#btn', text: 'hi' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'type',
        params: { selector: '#btn', text: 'hi' },
      });
    });

    it('maps browser_fill_form', async () => {
      await executeBrowserTool('browser_fill_form', {
        fields: [{ selector: '#btn', value: 'hi' }],
      });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'fill_form',
        params: { fields: [{ selector: '#btn', value: 'hi' }] },
      });
    });

    it('maps browser_screenshot', async () => {
      await executeBrowserTool('browser_screenshot', { fullPage: true });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'screenshot',
        params: { fullPage: true, selector: undefined },
      });
    });

    it('maps browser_extract', async () => {
      await executeBrowserTool('browser_extract', { selector: '.content' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'extract',
        params: { dataSelectors: undefined, selector: '.content' },
      });
    });

    it('maps browser_wait_for', async () => {
      await executeBrowserTool('browser_wait_for', { selector: '.content', timeoutMs: 1000 });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'wait',
        params: { selector: '.content', timeoutMs: 1000 },
      });
    });

    it('maps browser_scroll', async () => {
      await executeBrowserTool('browser_scroll', { direction: 'down', pixels: 100 });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'scroll',
        params: { direction: 'down', pixels: 100 },
      });
    });

    it('maps browser_select', async () => {
      await executeBrowserTool('browser_select', { selector: 'select', value: '1' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'select',
        params: { selector: 'select', value: '1' },
      });
    });

    it('maps browser_press_key', async () => {
      await executeBrowserTool('browser_press_key', { key: 'Enter', selector: 'input' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'press_key',
        params: { key: 'Enter', selector: 'input' },
      });
    });

    it('maps browser_navigate_back', async () => {
      await executeBrowserTool('browser_navigate_back', {});
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'navigate_back',
        params: {},
      });
    });

    it('maps browser_navigate_forward', async () => {
      await executeBrowserTool('browser_navigate_forward', {});
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'navigate_forward',
        params: {},
      });
    });

    it('maps browser_reload', async () => {
      await executeBrowserTool('browser_reload', {});
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'reload',
        params: {},
      });
    });

    it('maps browser_find', async () => {
      await executeBrowserTool('browser_find', { query: 'test' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'find',
        params: { query: 'test' },
      });
    });

    it('maps browser_inspect_page', async () => {
      await executeBrowserTool('browser_inspect_page', { selector: 'body' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'inspect_page',
        params: { selector: 'body' },
      });
    });

    it('maps browser_hover', async () => {
      await executeBrowserTool('browser_hover', { selector: '#btn' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'hover',
        params: { selector: '#btn' },
      });
    });

    it('maps browser_get_state', async () => {
      await executeBrowserTool('browser_get_state', {});
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'get_state',
        params: {},
      });
    });

    it('maps browser_accessibility_tree', async () => {
      await executeBrowserTool('browser_accessibility_tree', { selector: 'body' });
      expect(mockComputerService.executeAction).toHaveBeenCalledWith({
        type: 'accessibility_tree',
        params: { selector: 'body' },
      });
    });

    it('returns error if ComputerService fails', async () => {
      mockComputerService.executeAction.mockResolvedValue({ success: false, error: 'fail' });
      const result = await executeBrowserTool('browse_web', { url: 'https://example.com' });
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('returns error if tool unknown', async () => {
      const result = await executeBrowserTool('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown browser tool');
    });

    it('returns error if browser unavailable', async () => {
      mockBrowserService.isAvailable.mockResolvedValue(false);
      const result = await executeBrowserTool('browse_web', { url: 'https://example.com' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Browser is not available');
    });
  });
});
