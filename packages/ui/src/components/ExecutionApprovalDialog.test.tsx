// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, hasText, render } from '../test-harness';
import { ExecutionApprovalDialog } from './ExecutionApprovalDialog';

const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('ExecutionApprovalDialog', () => {
  afterEach(cleanup);

  it('shows a social post as readable text and approves it', async () => {
    const onResolve = vi.fn();
    const root = render(
      <ExecutionApprovalDialog
        approval={{
          approvalId: 'a1',
          category: 'publish_social_post',
          description: 'Publish this post publicly to the Aqvion Labs company page on linkedin?',
          code: 'Quantum is coming.\n\n#Quantum',
        }}
        onResolve={onResolve}
      />
    );

    expect(hasText(root, 'Approve post')).toBe(true);
    expect(hasText(root, 'Code Execution Approval')).toBe(false);
    expect(root.querySelector('pre')).toBeNull();
    expect(root.querySelector('p.whitespace-pre-wrap')?.textContent).toBe(
      'Quantum is coming.\n\n#Quantum'
    );

    await act(async () => button(root, 'Approve').click());
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  it('keeps the code view for code execution', () => {
    const root = render(
      <ExecutionApprovalDialog
        approval={{ approvalId: 'a2', category: 'execute_shell', description: 'Run', code: 'ls' }}
        onResolve={vi.fn()}
      />
    );
    expect(hasText(root, 'Code Execution Approval')).toBe(true);
    expect(root.querySelector('pre')?.textContent).toBe('ls');
  });
});
