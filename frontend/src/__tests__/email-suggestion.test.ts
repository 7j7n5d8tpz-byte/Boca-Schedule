import { describe, it, expect } from 'vitest';
import { suggestEmailCorrection } from '../utils';

describe('suggestEmailCorrection', () => {
  it.each([
    ['jacob@gmial.com', 'jacob@gmail.com'],
    ['jacob@gmail.con', 'jacob@gmail.com'],
    ['jacob@hotmial.com', 'jacob@hotmail.com'],
    ['jacob@hotmail.dl', 'jacob@hotmail.dk'],
    ['jacob@outlok.dk', 'jacob@outlook.dk'],
    ['Jacob.Meier@Gmai.com', 'Jacob.Meier@gmail.com'],
  ])('suggests a fix for %s', (typo, fixed) => {
    expect(suggestEmailCorrection(typo)).toBe(fixed);
  });

  it.each(['jacob@gmail.com', 'jacob@hotmail.dk', 'andreas@brendstrup.dk', 'x@company.io', 'not-an-email', 'jacob@'])(
    'leaves %s alone', email => {
      expect(suggestEmailCorrection(email)).toBeNull();
    },
  );
});
