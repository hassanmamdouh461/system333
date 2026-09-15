import { describe, expect, it } from 'vitest';
import {
  bool01,
  boundInlineImages,
  omitFields,
  clientError,
  rejected,
  MAX_PUBLIC_IMAGE_TOTAL_BYTES,
} from '../shared/common.js';

describe('bool01', () => {
  it('treats the string "false" as false', () => {
    // The reason this exists: a plain truthiness test sees a non-empty string and returns 1,
    // so every item serialised from a form was published to the public menu as available.
    expect(bool01('false')).toBe(0);
    expect(bool01('FALSE')).toBe(0);
    expect(bool01(' false ')).toBe(0);
    expect(bool01('0')).toBe(0);
    expect(bool01('no')).toBe(0);
    expect(bool01('off')).toBe(0);
    expect(bool01('')).toBe(0);
  });

  it('treats the string "true" as true', () => {
    expect(bool01('true')).toBe(1);
    expect(bool01('TRUE')).toBe(1);
    expect(bool01('1')).toBe(1);
    expect(bool01('yes')).toBe(1);
  });

  it('keeps the old behaviour for everything it has always been given', () => {
    expect(bool01(true)).toBe(1);
    expect(bool01(false)).toBe(0);
    expect(bool01(1)).toBe(1);
    expect(bool01(0)).toBe(0);
    expect(bool01(null)).toBe(0);
    expect(bool01(undefined)).toBe(0);
  });
});

describe('boundInlineImages', () => {
  const item = (id: string, size: number) => ({ id, image: 'x'.repeat(size) });

  it('keeps every image that fits the budget', () => {
    const { rows, imagesTruncated } = boundInlineImages([item('a', 10), item('b', 20)], 'image', 100);
    expect(rows).toHaveLength(2);
    expect(imagesTruncated).toBe(false);
  });

  it('drops the image from the tail once the budget is spent, keeping the row', () => {
    // An item without its photo still sells; a response the worker cannot build sells nothing.
    const { rows, imagesTruncated } = boundInlineImages([item('a', 90), item('b', 90)], 'image', 100);
    expect(imagesTruncated).toBe(true);
    expect(rows[0].image).toBe('x'.repeat(90));
    expect(rows[1].image).toBeUndefined();
    expect(rows[1].id).toBe('b');
  });

  it('preserves order, so the menu does not reshuffle when part of it loses pictures', () => {
    const rows = boundInlineImages(
      [item('a', 1), item('b', 999), item('c', 1)],
      'image',
      50
    ).rows;
    expect(rows.map((row: { id: string }) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a row with no image alone instead of flagging it', () => {
    const { rows, imagesTruncated } = boundInlineImages([{ id: 'a' }], 'image', 10);
    expect(rows[0]).toEqual({ id: 'a' });
    expect(imagesTruncated).toBe(false);
  });

  it('bounds an unauthenticated public menu well inside what a worker may hold', () => {
    // 1000 rows x 400 kB is ~400 MB; the isolate is allowed a fraction of that.
    expect(MAX_PUBLIC_IMAGE_TOTAL_BYTES).toBeLessThan(32_000_000);
  });
});

describe('omitFields', () => {
  it('drops the named columns and keeps everything else', () => {
    const rows = omitFields([{ id: 'o1', total: 10, cashierAvatar: 'x'.repeat(100) }], ['cashierAvatar']);
    expect(rows[0]).toEqual({ id: 'o1', total: 10 });
  });

  it('does not mutate the row it was given', () => {
    const source = { id: 'o1', cashierAvatar: 'big' };
    omitFields([source], ['cashierAvatar']);
    expect(source.cashierAvatar).toBe('big');
  });

  it('is a no-op when there is nothing to drop', () => {
    const input = [{ id: 'o1' }];
    expect(omitFields(input, [])).toBe(input);
  });
});

describe('clientError', () => {
  it('passes a validated 4xx detail through, because the caller can act on it', () => {
    // Only a rejection this worker raised itself is safe to echo: it is a sentence written
    // here, not a database message. An arbitrary Error carries whatever it was constructed
    // with — a D1 message can still be a 400 by status — so it is withheld like any 5xx.
    expect(clientError(rejected('branchId must be at most 40 characters'), 400))
      .toBe('branchId must be at most 40 characters');
    expect(clientError(new Error('no such table: customers'), 400)).toBe('Internal server error');
  });

  it('withholds a 5xx detail, because it carries the schema with it', () => {
    // "no such table: customers" is a free map of the database to anyone who can reach it.
    const message = clientError(new Error('no such table: customers'), 500);
    expect(message).toBe('Internal server error');
    expect(message).not.toContain('customers');
  });

  it('never leaks a 5xx cause through a non-Error value either', () => {
    expect(clientError('table orders has no column named paidAt', 500)).toBe('Internal server error');
  });
});
