import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('source and CI smoke checks', () => {
  it('has a production build command', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.scripts.build).toBeTruthy();
  });
  it('includes the application source directory', () => {
    expect(existsSync(resolve('src'))).toBe(true);
  });
});
