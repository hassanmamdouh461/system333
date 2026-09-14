// Minimal entry point for the Workers static-assets deployment. The assets are served
// directly by the platform; this worker adds no runtime behavior.
//
// Shared by both static sites (the manager portal and the public menu), so it must not name
// either one: a response naming the wrong service sends whoever is debugging at 3am to look
// in the wrong place.
export default {
  async fetch() {
    return new Response('Engaz', { status: 200 });
  },
};
