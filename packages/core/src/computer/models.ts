export type ComputerActionType =
  | 'mouseMove'
  | 'doubleClick'
  | 'mouseDown'
  | 'mouseUp'
  | 'keyPress'
  | 'typeText'
  | 'hotkey'
  | 'navigate'
  | 'click'
  | 'type'
  | 'scroll'
  | 'screenshot'
  | 'execute_shell'
  | 'read_file'
  | 'write_file'
  | 'press_key'
  | 'hover'
  | 'extract'
  | 'wait'
  | 'select'
  | 'navigate_back'
  | 'get_state'
  | 'accessibility_tree'
  | 'navigate_forward'
  | 'reload'
  | 'find'
  | 'inspect_page'
  | 'fill_form';

export interface ComputerAction {
  type: ComputerActionType;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ComputerActionResult {
  success: boolean;
  outcome?: 'SUCCESS' | 'DENIED' | 'WAITING_APPROVAL' | 'UNKNOWN';
  approvalId?: string;
  sessionId?: string;
  actionId?: string;
  data?: unknown;
  screenshotBase64?: string;
  accessibilityTree?: unknown;
  error?: string;
}

export type ComputerCapability =
  'read_only' | 'browser' | 'app_control' | 'file_operations' | 'shell' | 'system_control';

export interface ComputerTask {
  id: string;
  userId: string;
  accountId?: string;
  targetUrl?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  actions: ComputerAction[];
  results: ComputerActionResult[];
  createdAt: string;
  updatedAt: string;
}
