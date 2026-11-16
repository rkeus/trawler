import { afterAll } from 'vitest';
import { removeTmpDirs } from './helpers/tmp';

afterAll(removeTmpDirs);
