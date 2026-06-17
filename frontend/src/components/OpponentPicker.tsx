import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const ADD_SENTINEL = '__add_new__';

interface Opponent {
  opponentId: string;
  name: string;
  matchesPlayed: number;
}

interface Props {
  opponentId: string | null;
  onChange: (opponentId: string | null, name: string | null) => void;
}

/**
 * Pick an existing opponent or register a new one. Modeled on LocationPicker:
 * a dropdown of known opponents plus an inline "add new" flow that creates the
 * opponent (find-or-create on the backend) and selects it. Emits the chosen
 * opponentId so callers store the FK rather than free text.
 */
export default function OpponentPicker({ opponentId, onChange }: Props) {
  const qc = useQueryClient();
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');

  const { data: opponents = [] } = useQuery<Opponent[]>({
    queryKey: ['opponents'],
    queryFn: () => api.get('/opponents').then(r => r.data.data),
  });

  const addMutation = useMutation({
    mutationFn: (name: string) => api.post('/opponents', { name }).then(r => r.data.data),
    onSuccess: (created: { opponentId: string; name: string }) => {
      qc.invalidateQueries({ queryKey: ['opponents'] });
      onChange(created.opponentId, created.name);
      setAddingNew(false);
      setNewName('');
      setAddError('');
    },
    onError: () => setAddError('Failed to add opponent'),
  });

  function handleSelectChange(val: string) {
    if (val === ADD_SENTINEL) {
      setAddingNew(true);
      setNewName('');
    } else if (val === '') {
      onChange(null, null);
    } else {
      const opp = opponents.find(o => o.opponentId === val);
      onChange(val, opp?.name ?? null);
    }
  }

  function submitNew() {
    if (!newName.trim()) return;
    addMutation.mutate(newName.trim());
  }

  return (
    <div className="space-y-2">
      <select
        aria-label="Opponent"
        value={addingNew ? ADD_SENTINEL : (opponentId ?? '')}
        onChange={e => handleSelectChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
      >
        <option value="">No opponent</option>
        {opponents.map(o => (
          <option key={o.opponentId} value={o.opponentId}>{o.name}</option>
        ))}
        <option value={ADD_SENTINEL}>+ Add opponent…</option>
      </select>

      {addingNew && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            autoFocus
            placeholder="New opponent name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          <button
            type="button"
            onClick={submitNew}
            disabled={!newName.trim() || addMutation.isPending}
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
    </div>
  );
}
