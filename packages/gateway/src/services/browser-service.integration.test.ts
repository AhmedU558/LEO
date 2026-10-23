import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserService } from './browser-service.js';

describe.skipIf(process.env.LEO_QA_BROWSER !== '1')(
  'BrowserService with real isolated Chrome contexts',
  () => {
    let service: BrowserService;
    const session = 'qa-browser:default:local';
    beforeAll(async () => {
      service = new BrowserService();
      expect(await service.isAvailable()).toBe(true);
      // Seed synthetic HTML directly: no external site or SSRF exception is needed.
      const page = await service['getOrCreatePage'](session, 'qa-browser');
      await page.setContent(
        '<title>Local QA</title><input id="name"><button onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Copy</button><p id="result"></p>'
      );
    });
    afterAll(async () => {
      await service?.shutdown();
    });

    it('types, clicks, extracts and captures a real screenshot', async () => {
      await service.type(session, '#name', 'local fixture');
      await service.click(session, 'button');
      expect((await service.extractText(session, '#result')).text).toBe('local fixture');
      const png = Buffer.from((await service.screenshot(session)).screenshot, 'base64');
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });
    it('keeps cookies in separate execution contexts and closes a session', async () => {
      const first = await service['getOrCreatePage'](session, 'qa-browser');
      const secondId = 'qa-browser:other:local';
      const second = await service['getOrCreatePage'](secondId, 'qa-browser');
      await first
        .browserContext()
        .setCookie({ name: 'qa', value: 'private', domain: 'leo.invalid', path: '/' });
      expect((await second.browserContext().cookies()).some((cookie) => cookie.name === 'qa')).toBe(
        false
      );
      expect(await service.closePage(secondId)).toBe(true);
      expect(await service.getState(secondId)).toBeNull();
    });
    it('retains localhost and non-HTTP navigation protections', async () => {
      await expect(service.navigate(session, 'qa-browser', 'http://127.0.0.1:1')).rejects.toThrow(
        /blocked|private/
      );
      await expect(service.navigate(session, 'qa-browser', 'file:///etc/passwd')).rejects.toThrow(
        /HTTP/
      );
    });
  }
);
