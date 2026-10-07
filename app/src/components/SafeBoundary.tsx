import { Component, type ReactNode } from 'react';
import { BrandMark } from './Logo';

/**
 * Catches anything that breaks while drawing. An audience screen goes plain
 * black at once and quietly reloads itself; the control window says what
 * happened and reloads. The show itself lives in the engine, so nothing is
 * lost: after the reload every window picks up exactly where it was.
 */
export class SafeBoundary extends Component<{ audience: boolean; reloadAfterMs?: number; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Lumora: a screen stopped working and will reload', error);
    this.timer = setTimeout(() => window.location.reload(), this.props.reloadAfterMs ?? 1500);
  }

  override componentWillUnmount() {
    clearTimeout(this.timer);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.audience) return <div style={{ position: 'fixed', inset: 0, background: '#000' }} data-crashed />;
    return (
      <div style={{ margin: 'auto', padding: 24, textAlign: 'center', color: '#e6e6e4' }} data-crashed>
        <BrandMark size={40} />
        <h2 style={{ margin: '12px 0 8px' }}>Something went wrong on this screen</h2>
        <p style={{ margin: 0, color: '#ababab' }}>Reloading it now. Your show is safe and nothing on the outputs changed.</p>
      </div>
    );
  }
}
