/**
 * Chat widget recovery and plain-text rendering.
 *
 * Models routinely emit widget JSON that is malformed beyond what the bracket
 * repair can fix -- most often a missing comma between properties. Recovery
 * salvages what it can instead of showing nothing. These tests drive each
 * recoverer through flattenChatWidgetsToText, so every assertion is the plain
 * text a Telegram/WhatsApp/Slack user would actually receive.
 *
 * Every malformed input below omits a comma between top-level properties, which
 * defeats both JSON.parse and repairJsonLikeWidgetData and so forces recovery.
 */
import { describe, expect, it } from 'vitest';
import { flattenChatWidgetsToText, normalizeChatWidgets } from './chat-widgets.js';

const flat = (tag: string) => flattenChatWidgetsToText(tag).trim();

describe('recovering malformed widgets', () => {
  describe('table', () => {
    it('recovers headers and array rows', () => {
      expect(
        flat(
          `<table data='{"headers":["Company","Risk"] "rows":[["AMD","High"],["SK Hynix","Medium"]]}' />`
        )
      ).toBe('| Company | Risk |\n| --- | --- |\n| AMD | High |\n| SK Hynix | Medium |');
    });

    it('falls back to "columns" when there are no headers', () => {
      expect(flat(`<table data='{"columns":["A","B"] "rows":[["1","2"]]}' />`)).toBe(
        '| A | B |\n| --- | --- |\n| 1 | 2 |'
      );
    });

    it('recovers truncated object rows against the declared headers', () => {
      expect(
        flat(
          `<table data='{"columns":["Company","Risk"] "rows":[{"Company":"AMD","Risk":"High"},{"Company":"Intel"' />`
        )
      ).toBe('| Company | Risk |\n| --- | --- |\n| AMD | High |\n| Intel |  |');
    });

    it('derives headers from object rows when none are declared', () => {
      expect(flat(`<table data='{"title":"Chips" "rows":[{"Name":"AMD","Risk":"High"}' />`)).toBe(
        '| Name | Risk |\n| --- | --- |\n| AMD | High |'
      );
    });

    it('degrades to a warning when nothing is recoverable', () => {
      const out = flat(`<table data='{"rows" 7 garbage' />`);
      expect(out).toContain('**');
      expect(out).not.toContain('|');
    });
  });

  describe('metrics', () => {
    it('recovers labelled items, preferring a quoted value over a number', () => {
      expect(
        flat(
          `<metrics data='{"title":"Q3" "items":[{"label":"Revenue","value":"$4M","detail":"+12%"},{"name":"Users","count":1200}]}' />`
        )
      ).toBe('**Q3**\n• Revenue: **$4M** — +12%\n• Users: **1200**');
    });

    it('falls back to loose key/value pairs when there are no items', () => {
      // Known quirk: with no collection key the whole object is read as one
      // item, so a "title" key would become that item's label and this
      // fallback would never be reached. Without one, it is.
      expect(flat(`<stats data='{"uptime":"99.9%" "incidents":2}' />`)).toBe(
        '• uptime: **99.9%**\n• incidents: **2**'
      );
    });

    it('falls back to items without a title', () => {
      expect(flat(`<metrics data='{"x":1 "items":[{"label":"A","value":"1"}]}' />`)).toBe(
        '• A: **1**'
      );
    });
  });

  describe('progress', () => {
    it('recovers label, a percentage value and max', () => {
      expect(flat(`<progress data='{"label":"Upload" "value":"45%" "max":200}' />`)).toBe(
        'Upload: 45/200'
      );
    });

    it('defaults the label and max', () => {
      expect(flat(`<progress data='{"title":"Sync" "percent":30}' />`)).toBe('Sync: 30/100');
    });

    it('falls back to a callout when there is no number or label', () => {
      expect(flat(`<progress data='{"body":"Waiting on review" "x":"y"}' />`)).toBe(
        '**Recovered widget content**\nWaiting on review'
      );
    });
  });

  describe('bar chart', () => {
    it('recovers bars with numeric and display values', () => {
      expect(
        flat(
          `<bar data='{"title":"Load" "bars":[{"label":"CPU","value":71},{"name":"RAM","value":"8 GB"}]}' />`
        )
      ).toBe('**Load**\n• CPU: 71\n• RAM: 8 GB');
    });

    it('falls back to a callout when there is no object to read bars from', () => {
      // Known quirk: every `{...}` chunk yields a bar (value defaults to 0), so
      // this fallback is reachable only when the payload has no object at all.
      expect(flat(`<bar_chart data='"heading":"Empty" "summary":"none"' />`)).toBe(
        '**Empty**\nnone'
      );
    });
  });

  describe('timeline', () => {
    it('recovers events with time, label and detail', () => {
      expect(
        flat(
          `<timeline data='{"title":"Launch" "events":[{"date":"Mon","title":"Freeze","detail":"No merges"},{"when":"Tue","label":"Ship"}]}' />`
        )
      ).toBe('**Launch**\n• Mon — Freeze: No merges\n• Tue — Ship');
    });

    it('recovers events without a title', () => {
      expect(flat(`<timeline data='{"x":1 "items":[{"time":"9am","text":"Standup"}]}' />`)).toBe(
        '• 9am: Standup'
      );
    });

    it('falls back to a callout without events', () => {
      expect(flat(`<timeline data='{"heading":"Later" "summary":"TBD"}' />`)).toBe(
        '**Later**\nTBD'
      );
    });
  });

  describe('lists', () => {
    it('recovers list items from title and detail fields', () => {
      expect(
        flat(
          `<list data='{"title":"Risks" "items":[{"title":"Supply","description":"Tight"},{"name":"Demand"}]}' />`
        )
      ).toBe('**Risks**\n• Supply\n• Demand');
    });

    it('recovers key/value facts', () => {
      expect(
        flat(
          `<facts data='{"title":"Box" "facts":[{"key":"CPU","value":"8 cores"},{"label":"Disk"}]}' />`
        )
      ).toBe('**Box**\n• **CPU:** 8 cores\n• Disk');
    });

    it('recovers steps without a widget title', () => {
      // Known quirk: the widget-title lookup scans the whole payload, so an
      // item's own "title" key would also surface as the widget heading.
      expect(flat(`<steps data='{"x":1 "steps":[{"label":"Plan","detail":"Scope it"}]}' />`)).toBe(
        '1. **Plan** — Scope it'
      );
    });

    it('degrades to a warning when no item is recoverable', () => {
      const out = flat(`<list data='{"items" [{"weird":7}' />`);
      expect(out).not.toContain('•');
      expect(out.length).toBeGreaterThan(0);
    });
  });

  describe('callouts and unknown widgets', () => {
    it('recovers a callout with its tone', () => {
      expect(
        flat(`<callout data='{"title":"Heads up" "body":"Rotate keys" "type":"warning"}' />`)
      ).toBe('**Heads up**\nRotate keys');
    });

    it('extracts loose pairs when there is no title or body', () => {
      expect(flat(`<widget name="mystery" data='{"owner":"ops" "region":"eu-west"}' />`)).toBe(
        '**Recovered widget content**\nowner: ops\nregion: eu-west'
      );
    });

    it('turns an unrecoverable widget into a warning callout', () => {
      const result = normalizeChatWidgets(`<widget name="mystery" data='{{{ 7 8 9' />`);
      expect(result).toContain('<widget name="callout"');
    });
  });
});

describe('flattening valid widgets to plain text', () => {
  const tag = (name: string, data: unknown) => `<${name} data='${JSON.stringify(data)}' />`;

  it('renders metrics, skipping items with neither label nor value', () => {
    expect(
      flat(
        tag('metrics', {
          title: 'Q3',
          items: [{ label: 'Rev', value: '4M' }, { detail: 'x' }, 'junk', { value: '9' }],
        })
      )
    ).toBe('**Q3**\n• Rev: **4M**\n• 9');
  });

  it('renders a table of object rows keyed by header', () => {
    expect(
      flat(
        tag('table', {
          title: 'T',
          headers: ['A', 'B'],
          rows: [{ A: '1', B: '2' }, ['3', '4'], 'skip'],
        })
      )
    ).toBe('**T**\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('renders nothing for an empty table', () => {
    expect(flat(tag('table', { headers: [], rows: [] }))).toBe('');
  });

  it('renders list and checklist states', () => {
    expect(
      flat(
        tag('checklist', {
          title: 'Todo',
          items: [
            { text: 'Ship', done: true },
            { title: 'Test', status: 'done' },
            { label: 'Doc', done: false },
            'Plain',
            { x: 1 },
          ],
        })
      )
    ).toBe('**Todo**\n• [x] Ship\n• [x] Test\n• [ ] Doc\n• Plain');
  });

  it('renders key/value pairs in every partial form', () => {
    expect(
      flat(
        tag('key_value', {
          items: [{ key: 'K', value: 'V' }, { key: 'OnlyKey' }, { value: 'OnlyValue' }, 'x'],
        })
      )
    ).toBe('• **K:** V\n• OnlyKey\n• OnlyValue');
  });

  it('renders cards in every partial form', () => {
    expect(
      flat(
        tag('cards', {
          title: 'C',
          items: [{ title: 'T', body: 'B' }, { title: 'OnlyTitle' }, { text: 'OnlyBody' }, 1],
        })
      )
    ).toBe('**C**\n\n**T** — B\n\n**OnlyTitle**\n\nOnlyBody');
  });

  it('renders steps, numbering only the ones with content', () => {
    expect(
      flat(
        tag('steps', { items: [{ title: 'A', detail: 'a' }, {}, { detail: 'only detail' }, 'x'] })
      )
    ).toBe('1. **A** — a\n2. only detail');
  });

  it('renders progress with defaults', () => {
    expect(flat(tag('progress', { value: '40%' }))).toBe('Progress: 40/100');
  });

  it('renders bars with display values and plain numbers', () => {
    expect(
      flat(
        tag('bar', {
          items: [{ label: 'A', displayValue: '1k' }, { name: 'B', count: 3 }, { label: '' }, 'x'],
        })
      )
    ).toBe('• A: 1k\n• B: 3');
  });

  it('renders a timeline, skipping empty events', () => {
    expect(
      flat(
        tag('timeline', {
          items: [{ time: 'Mon', label: 'Go', detail: 'now' }, { detail: 'just detail' }, {}, 'x'],
        })
      )
    ).toBe('• Mon — Go: now\n• just detail');
  });

  it('renders a callout with only a body', () => {
    expect(flat(tag('callout', { body: 'Just this' }))).toBe('Just this');
  });

  it('renders a non-object widget payload as its text', () => {
    expect(flat(`<callout data='"plain words"' />`)).toBe('plain words');
  });

  it('leaves widgets inside fenced code untouched', () => {
    const fenced = '```\n<list data=\'{"items":["a"]}\' />\n```';
    expect(flattenChatWidgetsToText(`${fenced}\n${tag('list', { items: ['b'] })}`)).toBe(
      `${fenced}\n• b`
    );
  });
});
