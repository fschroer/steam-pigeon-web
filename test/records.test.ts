import { describe, expect, it } from 'vitest';
import { groupRecords, parseObjectName, recordId, csvFileName, recordsPrefix } from '../src/records';

describe('object names (locator ADR-0040 decision 8)', () => {
  it('parses {record_ts}_{crc}.{bin,csv}', () => {
    expect(parseObjectName('1762300000_0a1b2c3d.csv')).toEqual({ recordTs: 1762300000, crc: '0a1b2c3d', ext: 'csv' });
    expect(parseObjectName('5_deadbeef.bin')).toEqual({ recordTs: 5, crc: 'deadbeef', ext: 'bin' });
  });

  it('rejects anything else', () => {
    for (const n of ['1762300000_0A1B2C3D.csv', '1762300000_0a1b2c3.csv', '1762300000_0a1b2c3d.txt', 'notes.csv', '_0a1b2c3d.csv']) {
      expect(parseObjectName(n)).toBeNull();
    }
  });

  it('builds the path the app uploads under', () => {
    expect(recordsPrefix('abc')).toBe('users/abc/locators');
  });
});

describe('groupRecords', () => {
  const dir = 'users/u/locators/1136992075';
  const item = (name: string) => ({ name, fullPath: `${dir}/${name}` });

  it('pairs .bin and .csv and sorts newest first', () => {
    const recs = groupRecords('1136992075', [
      item('100_00000001.bin'), item('200_00000002.csv'), item('100_00000001.csv'),
      item('200_00000002.bin'), item('300_00000003.bin'), item('junk.txt'),
    ]);
    expect(recs.map(recordId)).toEqual(['300_00000003', '200_00000002', '100_00000001']);
    expect(recs[0]).toEqual({ locatorId: '1136992075', recordTs: 300, crc: '00000003', binPath: `${dir}/300_00000003.bin` });
    expect(recs[2].csvPath).toBe(`${dir}/100_00000001.csv`);
    expect(recs[2].binPath).toBe(`${dir}/100_00000001.bin`);
  });

  it('keeps two records with the same timestamp apart by CRC', () => {
    const recs = groupRecords('1', [item('100_00000002.csv'), item('100_00000001.csv')]);
    expect(recs.map(recordId)).toEqual(['100_00000001', '100_00000002']);
  });

  it('names the download after the record', () => {
    expect(csvFileName({ locatorId: '1136992075', recordTs: 100, crc: '0000abcd' })).toBe('steam-pigeon_1136992075_100_0000abcd.csv');
  });
});

import { crc32Hex, flightTimeFromCsv, locatorLabel as label2 } from '../src/records';

describe('saving a CSV from the computer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32Hex('123456789')).toBe('cbf43926');
    expect(crc32Hex('')).toBe('00000000');
  });
  it('reads the USB export flight time as UTC', () => {
    expect(flightTimeFromCsv('Flight time: 2026-09-26 16:07:35\nLaunch detect time: 2000\ntime_ms,x\n'))
      .toBe(Date.UTC(2026, 8, 26, 16, 7, 35) / 1000);
    expect(flightTimeFromCsv('time_ms,x\n0,1\n')).toBeUndefined();
  });
  it('titles the computer folder', () => {
    expect(label2('0')).toBe('Saved from your computer');
  });
});

import { fileStem } from '../src/store';

describe('fileStem', () => {
  it('drops the folder and .csv', () => {
    expect(fileStem('Red Ryder Revisited_2026-09-26_09-07-35.csv')).toBe('Red Ryder Revisited_2026-09-26_09-07-35');
    expect(fileStem('C:\\Flights\\Shane.CSV')).toBe('Shane');
    expect(fileStem('  ')).toBeUndefined();
    expect(fileStem(undefined)).toBeUndefined();
  });
});
