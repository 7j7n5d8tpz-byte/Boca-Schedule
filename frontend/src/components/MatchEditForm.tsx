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

// Editable form values (venue/court split out of the encoded location string).
export interface MatchEditFields {
  matchDate: string;
  matchTime: string;
  venue: string;
  court: string;
  opponentId: string | null;
  matchCategory: 'serie' | 'pokal';
  serieLetter: string;
  signupOpenDate: string;
  signupCloseDate: string;
  minPlayers: number;
  maxPlayers: number;
}

// Seed form state from a match. Callers keep the returned object in their own
// state so they control save semantics (one page saves match + squad together).
export function initialMatchFields(match: EditableMatch): MatchEditFields {
  const { venue, court } = decodeLocation(match.location);
  return {
    matchDate: match.matchDate,
    matchTime: match.matchTime.slice(0, 5),
    venue,
    court,
    opponentId: match.opponentId ?? null,
    matchCategory: (match.matchCategory as 'serie' | 'pokal') ?? 'serie',
    serieLetter: match.serieLetter ?? 'A',
    signupOpenDate: match.signupOpenDate?.slice(0, 10) ?? '',
    signupCloseDate: match.signupCloseDate?.slice(0, 10) ?? '',
    minPlayers: match.minPlayers,
    maxPlayers: match.maxPlayers,
  };
}

// Build the PUT /matches body from the form values.
export function matchUpdatePayload(f: MatchEditFields) {
  return {
    matchDate: f.matchDate,
    matchTime: f.matchTime,
    location: encodeLocation(f.venue, f.court),
    opponentId: f.opponentId,
    matchCategory: f.matchCategory,
    serieLetter: f.matchCategory === 'serie' ? f.serieLetter : null,
    // Local-time interpretation (00:00 open, 20:00 deadline) → UTC instant,
    // matching NewMatch. A bare "…Z" treated these as UTC, an hour or two off
    // for CET/CEST users.
    signupOpenDate: new Date(f.signupOpenDate + 'T00:00:00').toISOString(),
    signupCloseDate: new Date(f.signupCloseDate + 'T20:00:00').toISOString(),
    minPlayers: f.minPlayers,
    maxPlayers: f.maxPlayers,
  };
}

// Shared "edit match details" fields — date/time, squad size, venue, opponent,
// category/serie and the signup window. Controlled and button-less so the host
// page owns the Save/Cancel buttons and persistence (MatchDetail saves the match
// alone; the squad page saves match + selections in one action).
export default function MatchEditForm({
  value,
  onChange,
  matchType,
}: {
  value: MatchEditFields;
  onChange: (next: MatchEditFields) => void;
  matchType: string;
}) {
  const set = (patch: Partial<MatchEditFields>) => onChange({ ...value, ...patch });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
        <input
          type="date"
          value={value.matchDate}
          onChange={e => set({ matchDate: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
        <input
          type="time"
          value={value.matchTime}
          onChange={e => set({ matchTime: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Min players</label>
        <input
          type="number"
          min={1}
          value={value.minPlayers}
          onChange={e => set({ minPlayers: parseInt(e.target.value) || 0 })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Max players</label>
        <input
          type="number"
          min={1}
          value={value.maxPlayers}
          onChange={e => set({ maxPlayers: parseInt(e.target.value) || 0 })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Venue <span className="text-gray-400 font-normal">
            · {matchType === 'futsal' ? 'Hall (optional)' : 'Court (optional)'}
          </span>
        </label>
        <LocationPicker
          venue={value.venue}
          court={value.court}
          onVenueChange={v => set({ venue: v })}
          onCourtChange={c => set({ court: c })}
          matchType={matchType}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Opponent <span className="text-gray-400">(optional)</span></label>
        <OpponentPicker
          opponentId={value.opponentId}
          onChange={(id) => set({ opponentId: id })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
        <select
          value={value.matchCategory}
          onChange={e => set({ matchCategory: e.target.value as 'serie' | 'pokal' })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        >
          <option value="serie">Serie</option>
          <option value="pokal">Pokal</option>
        </select>
      </div>
      {value.matchCategory === 'serie' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Serie letter</label>
          <select
            value={value.serieLetter}
            onChange={e => set({ serieLetter: e.target.value })}
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
          value={value.signupOpenDate}
          onChange={e => set({ signupOpenDate: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Signup deadline</label>
        <input
          type="date"
          value={value.signupCloseDate}
          onChange={e => set({ signupCloseDate: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>
    </div>
  );
}
