/**
 * Browser Tools
 *
 * LLM-callable tools for headless browser automation.
 * Navigate pages, interact with elements, take screenshots, extract data.
 */

import type { ToolDefinition } from '@ownpilot/core/tools';
import { getBrowserService } from '../services/browser-service.js';
import { ComputerService } from '../services/computer/service.js';
import type { ComputerAction } from '@ownpilot/core/computer';

// ============================================================================
// Tool Definitions
// ============================================================================

const browseWebDef: ToolDefinition = {
  name: 'browse_web',
  brief: 'Navigate to a URL and read the rendered page',
  description:
    'Opens a URL in a headless browser, waits for the page to load (including JavaScript), ' +
    'and returns the page title and visible text content. Use this instead of fetch_web_page ' +
    'when you need to read JavaScript-rendered content (SPAs, dynamic pages).',
  category: 'Browser',
  tags: ['browser', 'web', 'navigate', 'page'],
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to (must be http or https)',
      },
    },
    required: ['url'],
  },
};

const browserClickDef: ToolDefinition = {
  name: 'browser_click',
  brief: 'Click an element on the current page',
  description:
    'Clicks an element matching the given CSS selector on the current browser page. ' +
    'You must have navigated to a page first using browse_web.',
  category: 'Browser',
  tags: ['browser', 'click', 'interact'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click (e.g., "button.submit", "#login-btn")',
      },
    },
    required: ['selector'],
  },
};

const browserTypeDef: ToolDefinition = {
  name: 'browser_type',
  brief: 'Type text into an input field',
  description:
    'Types text into an input element matching the given CSS selector. ' +
    'Clears the existing value first. You must have navigated to a page first.',
  category: 'Browser',
  tags: ['browser', 'type', 'input', 'form'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input field (e.g., "input[name=email]", "#search-box")',
      },
      text: {
        type: 'string',
        description: 'The text to type into the field',
      },
    },
    required: ['selector', 'text'],
  },
};

const browserFillFormDef: ToolDefinition = {
  name: 'browser_fill_form',
  brief: 'Fill multiple form fields at once',
  description:
    'Fills multiple form fields on the current page. Each field is specified by a CSS selector ' +
    'and a value. The system automatically checks for PII (email, phone, SSN, etc.) in field ' +
    'values and will include warnings if sensitive data is detected.',
  category: 'Browser',
  tags: ['browser', 'form', 'fill', 'input'],
  parameters: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Array of fields to fill, each with a selector and value',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the form field' },
            value: { type: 'string', description: 'Value to enter' },
          },
          required: ['selector', 'value'],
        },
      },
    },
    required: ['fields'],
  },
};

const browserScreenshotDef: ToolDefinition = {
  name: 'browser_screenshot',
  brief: 'Take a screenshot of the current page',
  description:
    'Captures a PNG screenshot of the current browser page. Returns a base64-encoded image. ' +
    'Optionally capture the full scrollable page or a specific element.',
  category: 'Browser',
  tags: ['browser', 'screenshot', 'capture', 'image'],
  parameters: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description:
          'Capture the full scrollable page instead of just the viewport (default: false)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector of a specific element to screenshot (optional)',
      },
    },
  },
};

const browserExtractDef: ToolDefinition = {
  name: 'browser_extract',
  brief: 'Extract text or structured data from the page',
  description:
    'Extracts content from the current browser page. Can extract plain text (from the whole ' +
    'page or a specific element) or structured data by providing a map of names to CSS selectors.',
  category: 'Browser',
  tags: ['browser', 'extract', 'scrape', 'data'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to extract text from (optional — extracts full page if omitted)',
      },
      dataSelectors: {
        type: 'object',
        description:
          'Map of field names to CSS selectors for structured extraction. ' +
          'Example: {"title": "h1", "price": ".price-tag", "description": ".desc"}',
        additionalProperties: { type: 'string' },
      },
    },
  },
};

const browserWaitForDef: ToolDefinition = {
  name: 'browser_wait_for',
  brief: 'Wait for an element to appear or for a fixed delay',
  description:
    'Pauses until a CSS selector becomes present on the page (preferred), or ' +
    'waits a fixed timeout if no selector is given. Essential for SPAs and ' +
    'pages where content loads asynchronously after navigation or interaction. ' +
    'Use this before browser_click / browser_extract when the target element ' +
    'may not be present yet.',
  category: 'Browser',
  tags: ['browser', 'wait', 'selector', 'spa'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description:
          'CSS selector to wait for (preferred). Resolves as soon as the element exists.',
      },
      timeoutMs: {
        type: 'number',
        description:
          'Max time to wait in milliseconds (default 5000). Also doubles as the pure-delay duration when no selector is given (capped at 10000).',
      },
    },
  },
};

const browserScrollDef: ToolDefinition = {
  name: 'browser_scroll',
  brief: 'Scroll the page up or down',
  description:
    'Scrolls the current page by a pixel amount. Use this to reveal lazy-loaded ' +
    'content (infinite-scroll lists, off-screen sections, dynamic comment threads) ' +
    'before extracting or clicking.',
  category: 'Browser',
  tags: ['browser', 'scroll', 'page'],
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'Scroll direction.',
      },
      pixels: {
        type: 'number',
        description: 'Pixels to scroll (default 500).',
      },
    },
    required: ['direction'],
  },
};

const browserSelectDef: ToolDefinition = {
  name: 'browser_select',
  brief: 'Choose an option in a <select> dropdown',
  description:
    'Selects an option by its value attribute in a native <select> dropdown. ' +
    'Use this for form fields that present a list of choices — e.g. country pickers, ' +
    'sort orders, filter dropdowns.',
  category: 'Browser',
  tags: ['browser', 'select', 'dropdown', 'form'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the <select> element.',
      },
      value: {
        type: 'string',
        description:
          "The option's value attribute to select (NOT its visible label — look at the <option value='...'> attribute).",
      },
    },
    required: ['selector', 'value'],
  },
};

const browserPressKeyDef: ToolDefinition = {
  name: 'browser_press_key',
  brief: 'Press a single keyboard key (Enter, Tab, Escape, etc.)',
  description:
    'Sends a keyboard key press to the active page. Supports single characters ' +
    '("a", "1") and named keys (Enter, Tab, Escape, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, ' +
    'Backspace, Delete). Essential for search bars that submit on Enter, modals ' +
    'that close on Esc, and any keyboard-driven UI element.',
  category: 'Browser',
  tags: ['browser', 'keyboard', 'key', 'press'],
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to press. Examples: "Enter", "Tab", "Escape", "ArrowDown", "a".',
      },
      selector: {
        type: 'string',
        description:
          'Optional CSS selector — when supplied the element is focused before the key fires.',
      },
    },
    required: ['key'],
  },
};

const browserNavigateBackDef: ToolDefinition = {
  name: 'browser_navigate_back',
  brief: 'Go back one page in browser history',
  description:
    'Navigates back to the previous page in history — the standard way to return ' +
    'from a detail/article page to the list you came from, so you can continue with ' +
    'the next item without re-running a search or re-applying filters. Returns ' +
    'navigated:false when there is no history to go back to (then navigate by URL instead).',
  category: 'Browser',
  tags: ['browser', 'navigate', 'back', 'history'],
  parameters: {
    type: 'object',
    properties: {},
  },
};

const browserHoverDef: ToolDefinition = {
  name: 'browser_hover',
  brief: 'Hover the pointer over an element',
  description:
    'Moves the pointer over an element to reveal hover-gated UI — dropdown menus, ' +
    'tooltips, and controls that only appear on hover — before you click or read them. ' +
    'Pair with browser_accessibility_tree afterwards to see what the hover revealed.',
  category: 'Browser',
  tags: ['browser', 'hover', 'menu', 'tooltip'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the element to hover over.',
      },
    },
    required: ['selector'],
  },
};

const browserGetStateDef: ToolDefinition = {
  name: 'browser_get_state',
  brief: 'Read the current URL + title without acting on the page',
  description:
    "Returns the active page's current URL and title without performing any action. " +
    'Use this to verify that a previous click or form submission landed where ' +
    'you expected before proceeding. Returns null when no page is open.',
  category: 'Browser',
  tags: ['browser', 'state', 'inspect'],
  parameters: {
    type: 'object',
    properties: {},
  },
};

const browserAccessibilityTreeDef: ToolDefinition = {
  name: 'browser_accessibility_tree',
  brief: 'Get the page as a structured accessibility (role/name) outline',
  description:
    'Returns the current page as an accessibility tree — a compact, indented outline of ' +
    'roles and names (button, link, textbox, heading, …) instead of raw HTML. This is the ' +
    'best way to understand page structure and find interactive elements to click/type into: ' +
    'it is far smaller than HTML and surfaces exactly what is actionable. State flags appear in ' +
    'brackets — [disabled], [checked], [expanded]/[collapsed], [selected], [required], [invalid], ' +
    '[focused] — so you can avoid acting on a disabled control or re-checking a checked box. ' +
    'Optionally pass a selector to scope the tree to a subtree.',
  category: 'Browser',
  tags: ['browser', 'accessibility', 'a11y', 'structure', 'navigate', 'inspect'],
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Optional CSS selector to scope the tree to a single subtree.',
      },
    },
  },
};

export const BROWSER_TOOLS: ToolDefinition[] = [
  browseWebDef,
  browserClickDef,
  browserTypeDef,
  browserFillFormDef,
  browserScreenshotDef,
  browserExtractDef,
  browserWaitForDef,
  browserScrollDef,
  browserSelectDef,
  browserPressKeyDef,
  browserNavigateBackDef,
  browserHoverDef,
  browserGetStateDef,
  browserAccessibilityTreeDef,
];

export const BROWSER_TOOL_NAMES = BROWSER_TOOLS.map((t) => t.name);

// ============================================================================
// Executor
// ============================================================================

export async function executeBrowserTool(
  toolName: string,
  args: Record<string, unknown>,
  _userId?: string,
  _context?: unknown
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (!(await getBrowserService().isAvailable())) {
    return {
      success: false,
      error:
        'Browser is not available. Chrome/Chromium is not installed or PUPPETEER_EXECUTABLE_PATH is not set.',
    };
  }

  // We no longer call getBrowserService directly here.

  // We use ComputerService to enforce ExecutionTaskContext, PolicyEngine, and ActionLedger.
  const computerService = new ComputerService();
  let action: ComputerAction;

  switch (toolName) {
    case 'browse_web':
      action = { type: 'navigate', params: { url: args.url } };
      break;
    case 'browser_click':
      action = { type: 'click', params: { selector: args.selector } };
      break;
    case 'browser_type':
      action = { type: 'type', params: { selector: args.selector, text: args.text } };
      break;
    case 'browser_fill_form':
      action = { type: 'fill_form', params: { fields: args.fields } };
      break;
    case 'browser_screenshot':
      action = { type: 'screenshot', params: { fullPage: args.fullPage, selector: args.selector } };
      break;
    case 'browser_extract':
      action = {
        type: 'extract',
        params: { dataSelectors: args.dataSelectors, selector: args.selector },
      };
      break;
    case 'browser_wait_for':
      action = { type: 'wait', params: { selector: args.selector, timeoutMs: args.timeoutMs } };
      break;
    case 'browser_scroll':
      action = { type: 'scroll', params: { direction: args.direction, pixels: args.pixels } };
      break;
    case 'browser_select':
      action = { type: 'select', params: { selector: args.selector, value: args.value } };
      break;
    case 'browser_press_key':
      action = { type: 'press_key', params: { key: args.key, selector: args.selector } };
      break;
    case 'browser_navigate_back':
      action = { type: 'navigate_back', params: {} };
      break;
    case 'browser_navigate_forward':
      action = { type: 'navigate_forward', params: {} };
      break;
    case 'browser_reload':
      action = { type: 'reload', params: {} };
      break;
    case 'browser_find':
      action = { type: 'find', params: { query: args.query } };
      break;
    case 'browser_inspect_page':
      action = { type: 'inspect_page', params: { selector: args.selector } };
      break;
    case 'browser_hover':
      action = { type: 'hover', params: { selector: args.selector } };
      break;
    case 'browser_get_state':
      action = { type: 'get_state', params: {} };
      break;
    case 'browser_accessibility_tree':
      action = { type: 'accessibility_tree', params: { selector: args.selector } };
      break;
    default:
      return { success: false, error: `Unknown browser tool: ${toolName}` };
  }

  // Ensure tool execute is bound to the task context.
  // It is expected that the caller (ToolExecutor) has set up ExecutionTaskContext.
  const result = await computerService.executeAction(action);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Return the inner result data instead of wrapping it again,
  // keeping compatibility with expected browser tool responses.
  if (
    toolName === 'browse_web' ||
    toolName === 'browser_screenshot' ||
    toolName === 'browser_accessibility_tree' ||
    toolName === 'browser_inspect_page' ||
    toolName === 'browser_fill_form' ||
    toolName === 'browser_find'
  ) {
    return { success: true, result: result.data || result };
  }

  return { success: true, result: result.data };
}
