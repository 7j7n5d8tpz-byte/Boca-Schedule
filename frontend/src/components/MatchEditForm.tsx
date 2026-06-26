import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import LocationPicker, { encodeLocation, decodeLocation } from './LocationPicker';
import OpponentPicker from './OpponentPicker';

// The subset of a match the edit form needs. Both the coach MatchDetail and the
// Selections/squad page pass a compatible object.
export interface EditableMatch {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponentId: string | null;
  matchType: string;
  matchCategory: string;
  serieLetter: string | null;
  signupOpenDate: string;
  signupCloseDate: string;
  minPlayers: number;
  maxPlayers: number;
}

// Shared "edit match details" form — date/time, squad size, venue, opponent,
// category/serie and the signup window. Extracted so MatchDetail and the squad
// page can both edit a match without duplicating the form. The caller handles
// query invalidation in `onSaved`.
export default function MatchEditForm({
  match,
  onSaved,
  onCancel,
}: {
  match: EditableMatch;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { venue: initialVenue, court: initialCourt } = decodeLocation(match.location);
  const [fields, setFields] = useState({
    matchDate: match.matchDate,
    matchTime: match.matchTime.slice(0, 5),
    opponentId: match.opponentId ?? null,
    matchCategory: (match.matchCategory as 'serie' | 'pokal') ?? 'serie',
    serieLetter: match.serieLetter ?? 'A',
    signupOpenDate: match.signupOpenDate?.slice(0, 10) ?? '',
    signupCloseDate: match.signupCloseDate?.slice(0, 10) ?? '',
    minPlayers: match.minPlayers,
    maxPlayers: match.maxPlayers,
  });
  const [venue, setVenue] = useState(initialVenue);
  const [court, setCourt] = useState(initialCourt);

  const editMutation = useMutation({
    mutationFn: () =>
      api.put(`/matches/${match.matchId}`, {
        matchDate: fields.matchDate,
        matchTime: fields.matchTime,
        location: encodeLocation(venue, court),
        opponentId: fields.opponentId,
        matchCategory: fields.matchCategory,
        serieLetter: fields.matchCategory === 'serie' ? fields.serieLetter : null,
        // Local-time interpretation (00:00 open, 20:00 deadline) → UTC instant,
        // matching NewMatch. A bare "…Z" treated these as UTC, an hour or two
        // off for CET/CEST users.
        signupOpenDate: new Date(fields.signupOpenDate + 'T00:00:00').toISOString(),
        signupCloseDate: new Date(fields.signupCloseDate + 'T20:00:00').toISOString(),
        minPlayers: fields.minPlayers,
        maxPlayers: fields.maxPlayers,
      }),
    onSuccess: () => onSaved(),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">Edit match details</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input
            type="date"
            value={fields.matchDate}
            onChange={e => setFields(f => ({ ...f, matchDate: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
          <input
            type="time"
            value={fields.matchTime}
            onChange={e => setFields(f => ({ ...f, matchTime: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Min players</label>
          <input
            type="number"
            min={1}
            value={fields.minPlayers}
            onChange={e => setFields(f => ({ ...f, minPlayers: parseInt(e.target.value) || 0 }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Max players</label>
          <input
            type="number"
            min={1}
            value={fields.maxPlayers}
            onChange={e => setFields(f => ({ ...f, maxPlayers: parseInt(e.target.value) || 0 }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Venue <span className="text-gray-400 font-normal">
              · {match.matchType === 'futsal' ? 'Hall (optional)' : 'Court (optional)'}
            </span>
          </label>
          <LocationPicker
            venue={venue}
            court={court}
            onVenueChange={setVenue}
            onCourtChange={setCourt}
            matchType={match.matchType}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Opponent <span className="text-gray-400">(optional)</span></label>
          <OpponentPicker
            opponentId={fields.opponentId}
            onChange={(id) => setFields(f => ({ ...f, opponentId: id }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select
            value={fields.matchCategory}
            onChange={e => setFields(f => ({ ...f, matchCategory: e.target.value as 'serie' | 'pokal' }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="serie">Serie</option>
            <option value="pokal">Pokal</option>
          </select>
        </div>
        {fields.matchCategory === 'serie' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Serie letter</label>
            <select
              value={fields.serieLetter}
              onChange={e => setFields(f => ({ ...f, serieLetter: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
            >
              {['Mester','A','B','C','D','E','F'].map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Signup opens</label>
          <input
            type="date"
            value={fields.signupOpenDate}
            onChange={e => setFields(f => ({ ...f, signupOpenDate: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Signup deadline</label>
          <input
            type="date"
            value={fields.signupCloseDate}
            onChange={e => setFields(f => ({ ...f, signupCloseDate: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Discard
        </button>
        <button
          onClick={() => editMutation.mutate()}
          disabled={editMutation.isPending}
          className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {editMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {editMutation.isError && (
        <p className="text-sm text-red-500">Failed to save changes.</p>
      )}
    </div>
  );
}
