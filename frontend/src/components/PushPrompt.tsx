import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import {
  enablePush, permissionState, promptSnoozed, pushConfig, snoozePrompt, type PushState,
} from '../push';

// The opt-in for push notifications, shown on the dashboard to players who
// haven't decided yet. It is the app's own banner, not the browser dialog: the
// system "Allow notifications" prompt only appears when the player taps
// "Slå notifikationer til", and a "Don't allow" there can't be asked again —
// so the banner filters out "not now" first. iPhone players in a Safari tab get
// the add-to-home-screen steps instead, since iOS only pushes to home-screen apps.
export default function PushPrompt() {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState | null>(null);
  const [outcome, setOutcome] = useState<'enabled' | 'denied' | null>(null);
  const [hidden, setHidden] = useState(() => promptSnoozed());

  useEffect(() => {
    let alive = true;
    pushConfig().then(({ enabled }) => {
      if (alive) setState(enabled ? permissionState() : 'unsupported');
    });
    return () => { alive = false; };
  }, []);

  const later = () => { snoozePrompt(); setHidden(true); };

  if (outcome) {
    return (
      <Banner
        status={outcome === 'enabled' ? 'success' : 'info'}
        title={outcome === 'enabled' ? t('push.banner.enabled') : t('push.banner.denied')}
        isDismissable
        dismissLabel={t('push.banner.dismiss')}
        onDismiss={() => setOutcome(null)}
      />
    );
  }

  if (hidden || (state !== 'default' && state !== 'ios-install')) return null;

  if (state === 'ios-install') {
    return (
      <Banner
        status="info"
        title={t('push.banner.iosTitle')}
        description={t('push.banner.iosDescription')}
        isDismissable
        dismissLabel={t('push.banner.dismiss')}
        onDismiss={later}
      />
    );
  }

  return (
    <Banner
      status="info"
      title={t('push.banner.title')}
      description={t('push.banner.description')}
      endContent={
        <HStack gap={2}>
          <Button
            variant="primary"
            size="sm"
            label={t('push.banner.enable')}
            clickAction={async () => {
              const next = await enablePush().catch(() => 'default' as PushState);
              setState(next);
              if (next === 'granted') setOutcome('enabled');
              else if (next === 'denied') setOutcome('denied');
            }}
          />
          <Button variant="ghost" size="sm" label={t('push.banner.later')} onClick={later} />
        </HStack>
      }
    />
  );
}
