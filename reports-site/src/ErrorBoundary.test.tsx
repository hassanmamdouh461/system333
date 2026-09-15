import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import ErrorBoundary from './ErrorBoundary';

describe('ErrorBoundary', () => {
  // Tested as a component rather than through a DOM renderer: the behaviour that matters is
  // what it does with a thrown error, and that is decidable from render() alone.
  const boundary = () => new ErrorBoundary({ children: null });

  it('renders the children when nothing has failed', () => {
    const instance = new ErrorBoundary({ children: createElement('p', null, 'hello') });
    expect(instance.render()).toBeTruthy();
  });

  it('swaps to a visible message once something throws', () => {
    const instance = boundary();
    (instance as unknown as { state: { error: Error | null } }).state = {
      error: new Error('Cannot read properties of null'),
    };

    const rendered = instance.render() as { props: Record<string, unknown> };
    // role="alert" is what makes a screen reader announce it; without it the failure is
    // silent to exactly the users who need to know the page is broken.
    expect(rendered.props.role).toBe('alert');
    expect(JSON.stringify(rendered)).toContain('Cannot read properties of null');
  });

  it('turns a thrown error into state, so the tree unmounts only once', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it('logs the failure with its component stack for the console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const instance = boundary();

    instance.componentDidCatch(new Error('boom'), { componentStack: '\n  in App' });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatch(/render error/i);
    spy.mockRestore();
  });

  it('offers a reload rather than leaving the user stranded', () => {
    const instance = boundary();
    (instance as unknown as { state: { error: Error | null } }).state = { error: new Error('x') };

    const rendered = instance.render() as { props: { children: unknown } };
    const tree = JSON.stringify(rendered);
    expect(tree).toMatch(/Reload/);
    expect(tree).toMatch(/safe/i);
  });
});
