import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch } from './helpers/data.js';

// A cancelled match is scored as a walkover — 3-0 to us when the opponent calls
// it off, 0-3 when we do. These cover where that forfeited result surfaces: the
// season record, the match list and the head-to-head, and where it deliberately
// does not (goal statistics, biggest win).
//
// Pinned to a season of its own so the aggregations can be asserted exactly.
const SEASON = 2018;
const WALKOVER_DATE = `${SEASON}-05-10`;
const PLAYED_DATE   = `${SEASON}-05-17`;

describe('Cancellation walkovers', () => {
  let coach: TestUser;
  let opponentId: string;
  let walkoverMatchId: string;
  let playedMatchId: string;

  beforeAll(async () => {
    coach = await createTestUser('coach', '-walkover');

    const opp = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: `Walkover FC ${Date.now()}` });
    opponentId = opp.body.data.opponentId;

    // One match the opponent cancelled…
    const cancelled = await createTestMatch({ status: 'published', match_date: WALKOVER_DATE, opponent_id: opponentId, opponent: 'Walkover FC' });
    walkoverMatchId = cancelled.match_id;
    await request(app)
      .put(`/api/matches/${walkoverMatchId}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'cancelled', cancelledBy: 'opponent' });

    // …and one actually played, won 2-1.
    const played = await createTestMatch({ status: 'completed', match_date: PLAYED_DATE, opponent_id: opponentId, opponent: 'Walkover FC' });
    playedMatchId = played.match_id;
    const { error } = await supabaseAdmin.from('match_results').insert({
      match_id: playedMatchId, goals_for: 2, goals_against: 1, recorded_by: played.created_by,
    });
    if (error) throw error;
  });

  afterAll(async () => {
    await Promise.all([walkoverMatchId, playedMatchId].filter(Boolean).map(deleteTestMatch));
    await supabaseAdmin.from('opponents').delete().eq('opponent_id', opponentId);
    await deleteTestUser(coach.userId);
  });

  it('counts towards the season record but not the goals conceded', async () => {
    const res = await request(app)
      .get(`/api/players/statistics/team?year=${SEASON}`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    const { overview, matchHistory } = res.body.data;
    expect(overview.wins).toBe(2);
    expect(overview.losses).toBe(0);
    expect(overview.gamesWithResults).toBe(2);
    // Only the match that was actually played concedes goals.
    expect(overview.totalGoalsAgainst).toBe(1);
    expect(overview.avgGoalsAgainst).toBe(1);
    // The walkover was never played, so it is not one of the team's games.
    expect(overview.teamGames).toBe(1);

    const walkover = matchHistory.find((m: any) => m.matchId === walkoverMatchId);
    expect(walkover).toMatchObject({ goalsFor: 3, goalsAgainst: 0, walkover: 'opponent' });
    expect(matchHistory.find((m: any) => m.matchId === playedMatchId).walkover).toBeNull();
  });

  it('appears in the season match list, flagged as a walkover', async () => {
    const res = await request(app)
      .get(`/api/players/statistics/highlights?year=${SEASON}`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    const walkover = res.body.data.highlights.find((h: any) => h.matchId === walkoverMatchId);
    expect(walkover).toMatchObject({ goalsFor: 3, goalsAgainst: 0, walkover: 'opponent' });
    expect(walkover.goals).toEqual([]);
  });

  it('counts in the head-to-head record but never as the biggest win', async () => {
    const res = await request(app)
      .get(`/api/opponents/${opponentId}/history`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    const { summary, matches } = res.body.data;
    expect(summary.played).toBe(2);
    expect(summary.wins).toBe(2);
    expect(summary.biggestWin.matchId).toBe(playedMatchId);
    expect(matches.find((m: any) => m.matchId === walkoverMatchId).walkover).toBe('opponent');
  });

  it('counts in the opponent list totals', async () => {
    const res = await request(app)
      .get('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    const opp = res.body.data.find((o: any) => o.opponentId === opponentId);
    expect(opp.matchesPlayed).toBe(2);
    expect(opp.wins).toBe(2);
  });
});
