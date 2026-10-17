// Route-group loading UI. Every (app) page reads its data on the server, so
// without this a nav click waits for the full render before anything changes.
// With it, Next wraps each page in Suspense: the sidebar + top bar stay put,
// the URL and active nav item update immediately, and this spinner fills the
// content area until the page streams in.
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
