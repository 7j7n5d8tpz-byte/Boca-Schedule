import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@astryxdesign/core/Switch';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { api } from '../api/client';
import {
  disablePush, enablePush, hasSubscription, permissionState, pushConfig, type PushState,
} from '../push';

// Settings → push notifications for this device. Renders nothing while the
// server has push switched off (no VAPID keys: local dev, CI).
export default function PushSettings() {
  const { t } = useTranslation();
  const [serverOn, setServerOn] = useState<boolean | null>(null);
  const [state, setState] = useState<PushState>(() => permissionState());
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { enabled } = await pushConfig();
      const subscribed = enabled && permissionState() === 'granted' ? await hasSubscription() : false;
      if (!alive) return;
      setServerOn(enabled);
      setOn(subscribed);
    })();
    return () => { alive = false; };
  }, []);

  if (!serverOn) return null;

  let body;
  if (state === 'unsupported') {
    body = <Text type="supporting">{t('push.settings.unsupported')}</Text>;
  } else if (state === 'ios-install') {
    body = <Text type="supporting">{t('push.settings.ios')}</Text>;
  } else if (state === 'denied') {
    body = <Text type="supporting">{t('push.settings.denied')}</Text>;
  } else {
    body = (
      <VStack gap={3}>
        <Switch
          label={t('push.settings.switch')}
          value={on}
          labelPosition="start"
          labelSpacing="spread"
          status={error ? { type: 'error', message: error } : undefined}
          changeAction={async checked => {
            setError('');
            try {
              if (checked) {
                const next = await enablePush();
                setState(next);
                setOn(next === 'granted');
              } else {
                await disablePush();
                setOn(false);
              }
            } catch {
              setError(t('push.settings.failed'));
              setOn(await hasSubscription());
            }
          }}
        />
        {on && (
          <Button
            size="sm"
            label={testSent ? t('push.settings.testSent') : t('push.settings.test')}
            clickAction={async () => {
              await api.post('/push/test');
              setTestSent(true);
              setTimeout(() => setTestSent(false), 2500);
            }}
          />
        )}
      </VStack>
    );
  }

  // Card frame matches the page's other (Tailwind) settings cards.
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <VStack gap={3}>
        <VStack gap={0.5}>
          <Text type="label">{t('push.settings.title')}</Text>
          <Text type="supporting">{t('push.settings.help')}</Text>
        </VStack>
        {body}
      </VStack>
    </div>
  );
}
