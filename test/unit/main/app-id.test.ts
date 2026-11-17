import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { APP_ID } from '../../../src/main/app-id';

describe('APP_ID', () => {
  it('equals appId in electron-builder.yml', () => {
    const yml = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8');
  });
});
