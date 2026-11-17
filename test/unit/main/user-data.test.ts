import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { chooseUserDataDir, PORTABLE_DATA_FOLDER } from '../../../src/main/user-data';

describe('chooseUserDataDir', () => {
  it('uses TRAWLER_USER_DATA first', () => {
    expect(chooseUserDataDir({ TRAWLER_USER_DATA: 'rel/data', PORTABLE_EXECUTABLE_DIR: 'D:\\usb' })).toBe(path.resolve('rel/data'));
  });

  it('keeps the data beside a portable exe', () => {
    expect(chooseUserDataDir({ PORTABLE_EXECUTABLE_DIR: 'D:\\usb\\Trawler' })).toBe(path.resolve('D:\\usb\\Trawler', PORTABLE_DATA_FOLDER));
  });

  it('leaves the default profile alone otherwise', () => {
    expect(chooseUserDataDir({})).toBeUndefined();
    expect(chooseUserDataDir({ TRAWLER_USER_DATA: '  ', PORTABLE_EXECUTABLE_DIR: '' })).toBeUndefined();
  });
});
