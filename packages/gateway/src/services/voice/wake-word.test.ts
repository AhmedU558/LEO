import { describe, expect, it } from 'vitest';
import { heardWakeWord } from './wake-word.js';

describe('heardWakeWord', () => {
  it.each(['Hey Leo.', 'hey, leo', 'Hi Leo!', 'Hey Lio', 'Okay Leo what time is it', 'HEY LEAH'])(
    'wakes on %j',
    (text) => expect(heardWakeWord(text)).toBe(true)
  );

  it.each(['', 'Leo', 'I asked Leo yesterday', 'hey there', 'Leonardo is here', 'hey leopard'])(
    'stays asleep on %j',
    (text) => expect(heardWakeWord(text)).toBe(false)
  );
});
