import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseConfig } from './types.js';

describe('QA-023: Database Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails hard in production if explicit config is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PASSWORD;

    expect(() => getDatabaseConfig()).toThrow(
      /Running in production without explicit database credentials/
    );
  });

  it('fails hard in production if using default password', () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTGRES_PASSWORD = 'ownpilot_secret';

    expect(() => getDatabaseConfig()).toThrow(
      /Refusing to start: POSTGRES_PASSWORD is set to the documented default value/
    );
  });

  it('succeeds in production if valid config is provided', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:valid_secret@127.0.0.1/db';
    process.env.POSTGRES_PASSWORD = 'valid_secret';

    const config = getDatabaseConfig();
    expect(config.postgresUrl).toBe('postgresql://user:valid_secret@127.0.0.1/db');
  });
});
