import { describe, it, expect } from 'vitest';
import { meetingTime } from '../utils';

describe('meetingTime', () => {
  it('subtracts one hour from a normal time', () => {
    expect(meetingTime('18:00')).toBe('17:00');
    expect(meetingTime('14:30')).toBe('13:30');
    expect(meetingTime('09:15')).toBe('08:15');
  });

  it('handles midnight boundary (00:30 → 23:30)', () => {
    expect(meetingTime('00:30')).toBe('23:30');
  });

  it('handles exact midnight (00:00 → 23:00)', () => {
    expect(meetingTime('00:00')).toBe('23:00');
  });

  it('handles 01:00 → 00:00', () => {
    expect(meetingTime('01:00')).toBe('00:00');
  });

  it('pads hours and minutes with leading zeros', () => {
    expect(meetingTime('10:05')).toBe('09:05');
    expect(meetingTime('01:00')).toBe('00:00');
  });
});
