import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  checkPortableDir,
  chooseUserDataDir,
  PORTABLE_APP_FILENAME,
  PORTABLE_DATA_FOLDER,
  resolveUserData,
  type PortableFs,
} from '../../../src/main/user-data';

const PORTABLE_ENV = { PORTABLE_EXECUTABLE_DIR: 'D:\\usb\\Trawler', PORTABLE_EXECUTABLE_APP_FILENAME: PORTABLE_APP_FILENAME };

describe('chooseUserDataDir', () => {
  it('uses TRAWLER_USER_DATA first', () => {
    expect(chooseUserDataDir({ ...PORTABLE_ENV, TRAWLER_USER_DATA: 'rel/data' })).toBe(path.resolve('rel/data'));
  });

  it('keeps the data beside our own portable exe', () => {
    expect(chooseUserDataDir(PORTABLE_ENV)).toBe(path.resolve('D:\\usb\\Trawler', PORTABLE_DATA_FOLDER));
    expect(chooseUserDataDir({ ...PORTABLE_ENV, PORTABLE_EXECUTABLE_APP_FILENAME: 'Trawler' })).toBe(
      path.resolve('D:\\usb\\Trawler', PORTABLE_DATA_FOLDER),
    );
  });

  it('ignores a portable folder of another app or without an app file name', () => {
    expect(chooseUserDataDir({ PORTABLE_EXECUTABLE_DIR: 'D:\\usb' })).toBeUndefined();
    expect(chooseUserDataDir({ PORTABLE_EXECUTABLE_DIR: 'D:\\usb', PORTABLE_EXECUTABLE_APP_FILENAME: 'other-app' })).toBeUndefined();
  });

  it('leaves the default profile alone otherwise', () => {
    expect(chooseUserDataDir({})).toBeUndefined();
    expect(chooseUserDataDir({ TRAWLER_USER_DATA: '  ', PORTABLE_EXECUTABLE_DIR: '' })).toBeUndefined();
  });
});

function fakeFs(over: Partial<PortableFs> = {}): PortableFs {
  return { mkdirSync: vi.fn(), accessSync: vi.fn(), constants: { W_OK: 2 }, ...over };
}

describe('checkPortableDir', () => {
  it('accepts a folder that can be created and written', () => {
    const fsLike = fakeFs();
    expect(checkPortableDir('D:\\usb\\TrawlerData', fsLike)).toEqual({ ok: true });
    expect(fsLike.mkdirSync).toHaveBeenCalledWith('D:\\usb\\TrawlerData', { recursive: true });
    expect(fsLike.accessSync).toHaveBeenCalledWith('D:\\usb\\TrawlerData', 2);
  });

  it('refuses an unwritable folder with a warning', () => {
    const fsLike = fakeFs({
      accessSync: () => {
        throw new Error('EACCES: permission denied');
      },
    });
    expect(checkPortableDir('D:\\usb\\TrawlerData', fsLike)).toEqual({
      ok: false,
      warning: 'The portable data folder D:\\usb\\TrawlerData is not usable (EACCES: permission denied); using the default profile.',
    });
  });

  it('refuses a UNC or device path without touching the disk', () => {
    const fsLike = fakeFs();
    const result = checkPortableDir('\\\\server\\share\\TrawlerData', fsLike);
    expect(result.ok).toBe(false);
    expect(fsLike.mkdirSync).not.toHaveBeenCalled();
  });
});

describe('resolveUserData', () => {
  it('does not check the explicit TRAWLER_USER_DATA folder', () => {
    const fsLike = fakeFs();
    expect(resolveUserData({ ...PORTABLE_ENV, TRAWLER_USER_DATA: 'x' }, fsLike)).toEqual({ dir: path.resolve('x') });
    expect(fsLike.mkdirSync).not.toHaveBeenCalled();
  });

  it('uses a usable portable folder', () => {
    expect(resolveUserData(PORTABLE_ENV, fakeFs())).toEqual({ dir: path.resolve('D:\\usb\\Trawler', PORTABLE_DATA_FOLDER) });
  });

  it('falls back to the default profile with a warning when the portable folder is not usable', () => {
    const result = resolveUserData(
      PORTABLE_ENV,
      fakeFs({
        mkdirSync: () => {
          throw new Error('read-only');
        },
      }),
    );
    expect(result.dir).toBeUndefined();
    expect(result.warning).toContain('read-only');
  });

  it('returns nothing outside a portable run', () => {
    expect(resolveUserData({}, fakeFs())).toEqual({});
  });
});
