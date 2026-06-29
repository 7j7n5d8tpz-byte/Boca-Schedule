import { describe, it, expect } from 'vitest';
import {
  computeMatchRating,
  averageRating,
  positionGroup,
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

  describe('matchResult', () => {
    it('derives win/draw/loss', () => {
      expect(matchResult(3, 1)).toBe('win');
      expect(matchResult(2, 2)).toBe('draw');
      expect(matchResult(0, 1)).toBe('loss');
    });
  });

  describe('computeMatchRating', () => {
    it('returns the base for an uneventful appearance', () => {
      expect(computeMatchRating({}, ['MID'])).toBe(6.0);
    });

    it('rewards a defender goal more than a striker goal', () => {
      const def = computeMatchRating({ goals: 1 }, ['DEF']);
      const str = computeMatchRating({ goals: 1 }, ['STR']);
      expect(def).toBeGreaterThan(str);
    });

    it('adds the Man of Match and result bonuses', () => {
      expect(computeMatchRating({ manOfMatch: true }, ['MID'])).toBeCloseTo(7.0);
      expect(computeMatchRating({ result: 'win' }, ['MID'])).toBeCloseTo(6.3);
      expect(computeMatchRating({ result: 'loss' }, ['MID'])).toBeCloseTo(5.8);
    });

    it('penalises cards', () => {
      expect(computeMatchRating({ yellowCards: 1 }, ['MID'])).toBeCloseTo(5.7);
      expect(computeMatchRating({ redCards: 1 }, ['MID'])).toBeCloseTo(5.0);
    });

    it('clamps to the 1–10 range', () => {
      expect(computeMatchRating({ goals: 20 }, ['DEF'])).toBe(10);
      expect(computeMatchRating({ redCards: 20 }, ['MID'])).toBe(1);
    });

    describe('multiple preferred positions', () => {
      it('blends weights as the average of the outfield roles', () => {
        // DEF goal weight 1.6, FWD 0.8 → blended 1.2
        expect(computeMatchRating({ goals: 1 }, ['DEF', 'STR'])).toBeCloseTo(7.2);
      });

      it('is independent of the order positions were listed in', () => {
        expect(computeMatchRating({ goals: 1 }, ['STR', 'DEF']))
          .toBe(computeMatchRating({ goals: 1 }, ['DEF', 'STR']));
      });

      it('defaults to a midfielder when no position is set', () => {
        expect(computeMatchRating({ goals: 1 }, [])).toBeCloseTo(7.1);   // MID goal 1.1
        expect(computeMatchRating({ goals: 1 }, null)).toBeCloseTo(7.1);
      });
    });

    describe('goalkeeping', () => {
      it('scores a match as GK whenever the player kept goal, regardless of preferred position', () => {
        // Listed as MID but kept goal both halves with a clean sheet:
        // GK clean sheet 1.5 + 2 halves × 0.25 = 8.0
        expect(computeMatchRating({ cleanSheet: true, gkHalves: 2 }, ['MID'])).toBeCloseTo(8.0);
      });

      it('ignores a GK preference for matches the player did not keep goal', () => {
        // Listed GK/MID but outfield this match → MID clean sheet 0.4, no GK weight
        expect(computeMatchRating({ cleanSheet: true }, ['GK', 'MID'])).toBeCloseTo(6.4);
      });

      it('values a clean sheet more for a keeper than a striker', () => {
        const gk  = computeMatchRating({ cleanSheet: true, gkHalves: 2 }, ['GK']);
        const fwd = computeMatchRating({ cleanSheet: true }, ['STR']);
        expect(gk).toBeGreaterThan(fwd);
      });
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
