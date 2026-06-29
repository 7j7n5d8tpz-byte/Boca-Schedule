import { describe, it, expect } from 'vitest';
import {
  computeMatchRating,
  averageRating,
  positionGroup,
  primaryPosition,
  matchResult,
} from '../src/lib/rating.js';

describe('rating', () => {
  describe('positionGroup', () => {
    it('maps stored position codes to rating groups', () => {
      expect(positionGroup('GK')).toBe('GK');
      expect(positionGroup('DEF')).toBe('DEF');
      expect(positionGroup('MID')).toBe('MID');
      expect(positionGroup('WIN')).toBe('MID');
      expect(positionGroup('STR')).toBe('FWD');
    });

    it('falls back to MID for unknown / missing positions', () => {
      expect(positionGroup(null)).toBe('MID');
      expect(positionGroup(undefined)).toBe('MID');
      expect(positionGroup('XYZ')).toBe('MID');
    });
  });

  describe('primaryPosition', () => {
    it('takes the first preferred position', () => {
      expect(primaryPosition(['DEF', 'MID'])).toBe('DEF');
    });
    it('returns null when there is none', () => {
      expect(primaryPosition([])).toBeNull();
      expect(primaryPosition(null)).toBeNull();
    });
  });

  describe('matchResult', () => {
    it('derives win/draw/loss', () => {
      expect(matchResult(3, 1)).toBe('win');
      expect(matchResult(2, 2)).toBe('draw');
      expect(matchResult(0, 1)).toBe('loss');
    });
  });

  describe('computeMatchRating', () => {
    it('returns the base for an uneventful appearance', () => {
      expect(computeMatchRating({}, 'MID')).toBe(6.0);
    });

    it('rewards a defender goal more than a striker goal', () => {
      const def = computeMatchRating({ goals: 1 }, 'DEF');
      const str = computeMatchRating({ goals: 1 }, 'STR');
      expect(def).toBeGreaterThan(str);
    });

    it('gives clean sheets real weight for defensive roles', () => {
      const gk  = computeMatchRating({ cleanSheet: true }, 'GK');
      const fwd = computeMatchRating({ cleanSheet: true }, 'STR');
      expect(gk).toBeGreaterThan(fwd);
      expect(gk).toBeGreaterThan(6.0);
    });

    it('adds the Man of Match and result bonuses', () => {
      expect(computeMatchRating({ manOfMatch: true }, 'MID')).toBeCloseTo(7.0);
      expect(computeMatchRating({ result: 'win' }, 'MID')).toBeCloseTo(6.3);
      expect(computeMatchRating({ result: 'loss' }, 'MID')).toBeCloseTo(5.8);
    });

    it('credits halves in goal', () => {
      expect(computeMatchRating({ gkHalves: 2 }, 'GK')).toBeCloseTo(6.5);
    });

    it('penalises cards', () => {
      expect(computeMatchRating({ yellowCards: 1 }, 'MID')).toBeCloseTo(5.7);
      expect(computeMatchRating({ redCards: 1 }, 'MID')).toBeCloseTo(5.0);
    });

    it('clamps to the 1–10 range', () => {
      expect(computeMatchRating({ goals: 20 }, 'DEF')).toBe(10);
      expect(computeMatchRating({ redCards: 20 }, 'MID')).toBe(1);
    });
  });

  describe('averageRating', () => {
    it('averages and rounds to 2dp', () => {
      expect(averageRating([6, 7, 8])).toBe(7);
      expect(averageRating([6.0, 7.5])).toBe(6.75);
    });
    it('returns null with no ratings', () => {
      expect(averageRating([])).toBeNull();
    });
  });
});
