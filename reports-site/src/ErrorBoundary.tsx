import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last thing standing between a render error and a blank white page.
 *
 * This portal is the only view a manager has of the day's trading. Without a boundary, one
 * unexpected value in one row — a null where the code expects a string, a shape the portal was
 * not written for — unmounts the whole tree and leaves a blank screen with no explanation. At
 * that point the manager cannot tell "no sales today" from "the page is broken", which is the
 * single most expensive misunderstanding this screen can produce.
 *
 * So a failure shows a visible message and a way out, instead of nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is where the stack belongs; the screen is where the reassurance belongs.
    console.error('[reports] Unhandled render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f1115',
          color: '#e6e6e6',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
          Something went wrong displaying this page
        </h1>
        <p style={{ margin: 0, maxWidth: '40rem', lineHeight: 1.6, color: '#b9c0cc' }}>
          The data itself is safe — this is a problem showing it. Reloading usually fixes it. If it
          keeps happening, the details in the browser console will say which part failed.
        </p>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#8b95a5' }}>{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '0.6rem 1.4rem',
            borderRadius: '0.5rem',
            border: '1px solid #2a2f3a',
            background: '#7cc4ff',
            color: '#0f1115',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
