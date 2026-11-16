import { Component, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@astryxdesign/core/Toast';
import i18n from '../i18n';

/**
 * The one place a failed request becomes something the user can see.
 *
 * Most actions in the app (sign up, withdraw, the admin toggles, the fines
 * buttons…) had no error handler of their own, so a refused request just made
 * the button flicker back with no explanation, and a page that failed to load
 * looked the same as an empty one. This listens to every query and mutation:
 *
 *  - a mutation that fails and has no `onError` of its own → toast with the
 *    server's message (a mutation that handles its own error is left to it);
 *  - a query that fails with nothing to show yet → "couldn't load" toast.
 *    Background refreshes of data already on screen stay quiet, or the 30 s
 *    polls would nag every half minute while offline.
 */
export function RequestErrorToasts() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const show = (id: string, body: string) =>
      toast({ body, type: 'error', uniqueID: id, isAutoHide: true, autoHideDuration: 7000 });

    const offMutations = qc.getMutationCache().subscribe(e => {
      if (e.type !== 'updated' || e.action.type !== 'error' || e.mutation.options.onError) return;
      const message = (e.action.error as any)?.response?.data?.error?.message;
      show('action-failed', message ?? t('common.actionFailed'));
    });
    const offQueries = qc.getQueryCache().subscribe(e => {
      if (e.type !== 'updated' || e.action.type !== 'error' || e.query.state.data !== undefined) return;
      show('load-failed', t('common.loadFailed'));
    });
    return () => { offMutations(); offQueries(); };
  }, [qc, toast, t]);

  return null;
}

/** A render crash used to leave a blank white page. Offer a way back instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Render error:', error);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-gray-700">{i18n.t('common.crashed')}</p>
        <button
          onClick={() => window.location.assign('/')}
          className="bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {i18n.t('common.reload')}
        </button>
      </div>
    );
  }
}
