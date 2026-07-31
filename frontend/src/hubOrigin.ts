import { useLocation } from 'react-router-dom';

// Where a back control returns to. Links into the player hub carry one of these
// as router state so the hub names the list the user actually came from.
export interface HubOrigin {
  from: string;
  fromLabel: string;
}

// The player roster — the hub's home list, and the default when nothing else
// says otherwise. ?view= reopens the Players tab on the statistics page.
export const PLAYERS_HUB_ORIGIN: HubOrigin = { from: '/statistics?view=players', fromLabel: 'All players' };
export const ACHIEVEMENTS_ORIGIN: HubOrigin = { from: '/achievements', fromLabel: 'Achievements' };
export const DASHBOARD_ORIGIN: HubOrigin = { from: '/dashboard', fromLabel: 'Dashboard' };

/**
 * The origin the current page should hand on when it links somewhere new.
 *
 * Passing it along (rather than each component hard-coding its own page) keeps
 * a chain of hops anchored to the list the journey started from: opening a
 * crest on a player's hub and jumping to another player still goes back to the
 * roster, not to Achievements just because the crest modal lives there too.
 */
export function useHubOrigin(): HubOrigin {
  const { pathname, state } = useLocation();
  const carried = state as Partial<HubOrigin> | null;
  if (carried?.from && carried.fromLabel) return { from: carried.from, fromLabel: carried.fromLabel };
  if (pathname.startsWith('/achievements')) return ACHIEVEMENTS_ORIGIN;
  if (pathname.startsWith('/dashboard')) return DASHBOARD_ORIGIN;
  return PLAYERS_HUB_ORIGIN;
}
