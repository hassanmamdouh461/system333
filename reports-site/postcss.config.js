/**
 * The portal is plain CSS, not Tailwind.
 *
 * Without this file PostCSS walks up and finds the root config, so the portal's stylesheet
 * was being processed by Tailwind with the desktop app's content globs — which emitted a
 * "no content configured" warning on every build and scanned files the portal never uses.
 */
export default { plugins: {} };
