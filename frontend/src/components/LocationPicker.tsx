import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const ADD_SENTINEL = '__add_new__';

export function encodeLocation(venue: string, court: string): string {
  const c = court.trim();
  return c ? `${venue} · ${c}` : venue;
}

export function decodeLocation(location: string): { venue: string; court: string } {
  const idx = location.lastIndexOf(' · ');
  if (idx !== -1) {
    const maybeCourt = location.slice(idx + 3);
    if (/^\d+$/.test(maybeCourt)) {
      return { venue: location.slice(0, idx), court: maybeCourt };
    }
  }
  return { venue: location, court: '' };
}

export function formatLocation(location: string, matchType: string): string {
  const { venue, court } = decodeLocation(location);
  if (!court) return venue;
  const prefix = matchType === 'futsal' ? 'Hall' : 'Court';
  return `${venue} · ${prefix} ${court}`;
}

interface Props {
  venue: string;
  court: string;
  onVenueChange: (v: string) => void;
  onCourtChange: (c: string) => void;
  required?: boolean;
  matchType?: string;
}

export default function LocationPicker({ venue, court, onVenueChange, onCourtChange, required, matchType }: Props) {
  const isFutsal = matchType === 'futsal';
  const subLabel = isFutsal ? 'Hall' : 'Court';
  const qc = useQueryClient();
  const [addingNew, setAddingNew] = useState(false);
  const [newVenue, setNewVenue] = useState('');
  const [addError, setAddError] = useState('');
  const [managing, setManaging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: locations = [] } = useQuery<string[]>({
    queryKey: ['locations'],
    queryFn: () => api.get('/locations').then(r => r.data.data),
  });

  const addMutation = useMutation({
    mutationFn: (name: string) => api.post('/locations', { name }),
    onSuccess: (_, name) => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      onVenueChange(name.trim());
      setAddingNew(false);
      setNewVenue('');
      setAddError('');
    },
    onError: () => setAddError('Failed to add location'),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.delete('/locations', { data: { name } }),
    onSuccess: (_, name) => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      setConfirmDelete(null);
      if (venue === name) onVenueChange('');
    },
  });

  function handleSelectChange(val: string) {
    if (val === ADD_SENTINEL) {
      setAddingNew(true);
      setNewVenue('');
    } else {
      onVenueChange(val);
    }
  }

  function handleCourtInput(e: React.ChangeEvent<HTMLInputElement>) {
    onCourtChange(e.target.value.replace(/\D/g, '').slice(0, 3));
  }

  function submitNewVenue() {
    if (!newVenue.trim()) return;
    addMutation.mutate(newVenue.trim());
  }

  return (
    <div className="space-y-2">
      {/* Dropdown + court row */}
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <select
            required={required}
            value={addingNew ? ADD_SENTINEL : venue}
            onChange={e => handleSelectChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="" disabled>Select venue…</option>
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
            <option value={ADD_SENTINEL}>+ Add location…</option>
          </select>
        </div>
        <div className="w-28 shrink-0">
          <input
            type="text"
            inputMode="numeric"
            placeholder={subLabel}
            value={court}
            onChange={handleCourtInput}
            maxLength={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
      </div>

      {/* Add new venue */}
      {addingNew && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            autoFocus
            placeholder="New venue name"
            value={newVenue}
            onChange={e => setNewVenue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitNewVenue(); } }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          <button
            type="button"
            onClick={submitNewVenue}
            disabled={!newVenue.trim() || addMutation.isPending}
            className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            {addMutation.isPending ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => { setAddingNew(false); setAddError(''); }}
            className="shrink-0 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          {addError && <span className="text-xs text-red-500">{addError}</span>}
        </div>
      )}

      {/* Manage venues toggle */}
      {!addingNew && locations.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => { setManaging(v => !v); setConfirmDelete(null); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {managing ? 'Done managing' : 'Manage venues…'}
          </button>

          {managing && (
            <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
              {locations.map(loc => (
                <div key={loc} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-b-0 text-sm">
                  <span className="text-gray-700">{loc}</span>
                  {confirmDelete === loc ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600 font-medium">Delete?</span>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(loc)}
                        disabled={deleteMutation.isPending}
                        className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-2 py-0.5 rounded transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(loc)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
