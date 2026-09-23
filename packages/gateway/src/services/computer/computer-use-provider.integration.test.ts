import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { PuppeteerComputerUseProvider } from './computer-use-provider.js';
import { getBrowserService } from '../browser-service.js';

describe.skipIf(process.env.LEO_QA_BROWSER !== '1')('real isolated computer provider', () => {
  const browser = getBrowserService();
  const binding = {
    userId: 'computer-qa',
    workspaceId: 'w',
    executionTaskId: 't',
    sessionId: randomUUID(),
  };
  const ctx = {
    userId: binding.userId,
    workspaceId: 'w',
    taskId: 't',
    workflowId: 'wf',
    signal: new AbortController().signal,
  };
  const provider = new PuppeteerComputerUseProvider(ctx, binding);
  beforeAll(async () => {
    await provider.initialize(ctx.signal);
    const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
    await page.setContent(
      '<input id="entry" style="position:absolute;left:20px;top:20px;width:200px;height:40px"><div style="height:2000px"></div>'
    );
  });
  afterAll(async () => {
    await provider.close();
    await browser.shutdown();
  });

  it('executes coordinate mouse and keyboard primitives inside the page', async () => {
    await provider.mouseMove(40, 40);
    await provider.click(40, 40);
    await provider.typeText('first');
    await provider.hotkey(['Control', 'A']);
    await provider.typeText('replacement');
    const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
    expect(await page.$eval('#entry', (el) => (el as HTMLInputElement).value)).toBe('replacement');
    await provider.keyPress('Tab');
    await provider.doubleClick(40, 40);
    await provider.mouseDown(40, 40);
    await provider.mouseUp(40, 40);
    await provider.scroll(0, 100);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(100);
  });
  it('captures only the fixed viewport even on tall pages', async () => {
    const shot = await provider.screenshot();
    const png = Buffer.from(shot.screenshot, 'base64');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
    expect(png.length).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
  it('rejects viewport escapes, host shortcuts, clipboard and invalid keys', async () => {
    await expect(provider.click(-1, 20)).rejects.toThrow();
    await expect(provider.mouseMove(1280, 800)).rejects.toThrow();
    await expect(provider.hotkey(['Control', 'V'])).rejects.toThrow();
    await expect(provider.hotkey(['Control', 'L'])).rejects.toThrow();
    await expect(provider.keyPress('Meta')).rejects.toThrow();
  });
  it('isolates cookies and contexts across workspace/task bindings', async () => {
    const secondBinding = {
      ...binding,
      workspaceId: 'other',
      executionTaskId: 'other',
      sessionId: randomUUID(),
    };
    const second = new PuppeteerComputerUseProvider(
      { ...ctx, workspaceId: 'other', taskId: 'other' },
      secondBinding
    );
    try {
      await second.initialize(ctx.signal);
      const firstPage = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
      const otherPage = await browser['getOrCreatePage'](secondBinding.sessionId, binding.userId);
      expect(firstPage.browserContext()).not.toBe(otherPage.browserContext());
      await firstPage
        .browserContext()
        .setCookie({ name: 'secret', value: 'local', domain: 'leo.invalid', path: '/' });
      expect(await otherPage.browserContext().cookies()).toEqual([]);
    } finally {
      await second.close();
    }
  });
  it('retains SSRF protection and prohibits file navigation', async () => {
    expect((await provider.navigate('http://127.0.0.1:1')).success).toBe(false);
    expect((await provider.navigate('file:///etc/passwd')).success).toBe(false);
  });
  it('rejects mismatched context and reused session IDs without closing the owner session', async () => {
    expect(
      () => new PuppeteerComputerUseProvider({ ...ctx, workspaceId: 'other' }, binding)
    ).toThrow();
    for (const changes of [
      { userId: 'other' },
      { workspaceId: 'other' },
      { executionTaskId: 'other' },
    ]) {
      const wrongBinding = { ...binding, ...changes };
      const wrong = new PuppeteerComputerUseProvider(
        {
          ...ctx,
          userId: wrongBinding.userId,
          workspaceId: wrongBinding.workspaceId,
          taskId: wrongBinding.executionTaskId,
        },
        wrongBinding
      );
      await expect(wrong.initialize(ctx.signal)).rejects.toThrow('scope mismatch');
      await expect(browser.computerInput(wrongBinding, 'screenshot', {})).rejects.toThrow();
      await wrong.cancel();
      expect(browser.hasComputerSession(binding)).toBe(true);
    }
    expect(browser['parseSessionId'](binding.sessionId)).toEqual({
      userId: binding.userId,
      workspaceId: binding.workspaceId,
      executionId: binding.executionTaskId,
    });
    expect((await provider.screenshot()).width).toBe(1280);
  });
  it('blocks popup navigation before it can reach a private-network target', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.end('local fixture');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local server port');
      const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
      await page.setContent(
        `<button style="position:absolute;left:0;top:0;width:200px;height:100px" onclick="this.dataset.clicked='true';window.open('http://127.0.0.1:${address.port}')">Open</button>`
      );
      await provider.click(20, 20);
      expect(await page.$eval('button', (button) => button.dataset.clicked)).toBe('true');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requests).toBe(0);
      expect((await page.browserContext().pages()).length).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  // ---------------------------------------------------------------------------
  // Phase 6.9: what a real page actually discloses.
  // ---------------------------------------------------------------------------
  it('discloses safe labels and headings from a real page but never sensitive values', async () => {
    const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
    await page.setContent(
      '<body>' +
        '<h1>Order summary</h1>' +
        '<p>Choose a delivery option</p>' +
        '<button style="position:absolute;left:0;top:200px;width:120px;height:40px">Continue</button>' +
        '<a href="#" style="position:absolute;left:0;top:260px">Back to cart</a>' +
        '<input type="password" value="QA-REAL-PASSWORD" style="position:absolute;left:0;top:320px;width:200px;height:30px">' +
        '<input name="api_token" value="QA-REAL-TOKEN" style="position:absolute;left:0;top:360px;width:200px;height:30px">' +
        '<input autocomplete="one-time-code" value="998877" style="position:absolute;left:0;top:400px;width:200px;height:30px">' +
        '<p>QA-REAL-FREE-TEXT-SECRET</p>' +
        '<p>Reference 4815162342</p>' +
        '</body>'
    );
    const layout = await browser.computerRedactionLayout(binding);
    const serialized = JSON.stringify(layout);
    const texts = layout.controls.flatMap((c) => (c.text ? [c.text] : []));

    // Useful, non-sensitive semantics reach the model.
    expect(texts).toContain('Continue');
    expect(texts).toContain('Back to cart');
    expect(texts).toContain('Order summary');
    expect(texts).toContain('Choose a delivery option');
    expect(layout.controls.some((c) => c.kind === 'Heading' && c.text === 'Order summary')).toBe(
      true
    );

    // Sensitive values never appear, including as a control's own label. Input
    // values live in attributes and are never read, and the free-text secret and
    // the long digit run are withheld by the classifier.
    expect(serialized).not.toContain('QA-REAL-PASSWORD');
    expect(serialized).not.toContain('QA-REAL-TOKEN');
    expect(serialized).not.toContain('998877');
    expect(serialized).not.toContain('QA-REAL-FREE-TEXT-SECRET');
    expect(serialized).not.toContain('4815162342');
    for (const control of layout.controls)
      if (['Password', 'Secret', 'Authentication'].includes(control.kind))
        expect(control.text).toBeUndefined();

    // No page source, DOM internals or session identity rides along.
    expect(serialized).not.toContain('<body');
    expect(serialized).not.toContain('api_token');
    expect(serialized).not.toContain(binding.sessionId);
  });

  it('changes the layout revision when non-control content changes', async () => {
    const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
    await page.setContent('<body><h1>Step one</h1></body>');
    const before = await browser.computerRedactionLayout(binding);
    await page.setContent('<body><h1>Step two</h1></body>');
    const after = await browser.computerRedactionLayout(binding);

    // A heading change is now both observable and freshness-relevant, which is
    // what makes a dependent step able to notice it.
    expect(before.revision).not.toEqual(after.revision);
    expect(before.controls.some((c) => c.text === 'Step one')).toBe(true);
    expect(after.controls.some((c) => c.text === 'Step two')).toBe(true);
  });

  it('cancellation destroys the context and rejects stale reuse', async () => {
    const page = await browser['getOrCreatePage'](binding.sessionId, binding.userId);
    await page.close();
    await provider.cancel();
    expect(browser.getPageInfo(binding.sessionId)).toBeNull();
    await expect(provider.screenshot()).rejects.toThrow();
    await expect(provider.navigate('https://leo.invalid')).rejects.toThrow();
    await expect(provider.initialize(ctx.signal)).rejects.toThrow();
  });
});
