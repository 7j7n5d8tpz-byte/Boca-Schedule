import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PushPrompt from '../components/PushPrompt';

const push = vi.hoisted(() => ({
  pushConfig: vi.fn(),
  permissionState: vi.fn(),
  enablePush: vi.fn(),
  promptSnoozed: vi.fn(),
  snoozePrompt: vi.fn(),
}));
vi.mock('../push', () => push);

describe('PushPrompt', () => {
  beforeEach(() => {
    Object.values(push).forEach(fn => fn.mockReset());
    push.pushConfig.mockResolvedValue({ enabled: true, publicKey: 'key' });
    push.promptSnoozed.mockReturnValue(false);
  });

  it('shows the opt-in and only asks the browser when the player taps it', async () => {
    push.permissionState.mockReturnValue('default');
    push.enablePush.mockResolvedValue('granted');
    render(<PushPrompt />);

    const enable = await screen.findByRole('button', { name: 'Turn on notifications' });
    expect(push.enablePush).not.toHaveBeenCalled();
    await userEvent.click(enable);

    expect(push.enablePush).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notifications are on')).toBeInTheDocument();
  });

  it('"Not now" snoozes the banner', async () => {
    push.permissionState.mockReturnValue('default');
    render(<PushPrompt />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(push.snoozePrompt).toHaveBeenCalled();
    expect(screen.queryByText('Get notified when we need you on the pitch')).not.toBeInTheDocument();
  });

  it('tells iPhone players in Safari to add the app to the home screen', async () => {
    push.permissionState.mockReturnValue('ios-install');
    render(<PushPrompt />);
    expect(await screen.findByText('Get notifications on your iPhone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it.each(['granted', 'denied', 'unsupported'])('stays hidden when the state is %s', async state => {
    push.permissionState.mockReturnValue(state);
    const { container } = render(<PushPrompt />);
    await waitFor(() => expect(push.pushConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden while the server has push off', async () => {
    push.pushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    push.permissionState.mockReturnValue('default');
    const { container } = render(<PushPrompt />);
    await waitFor(() => expect(push.pushConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden while snoozed', async () => {
    push.promptSnoozed.mockReturnValue(true);
    push.permissionState.mockReturnValue('default');
    const { container } = render(<PushPrompt />);
    await waitFor(() => expect(push.pushConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
