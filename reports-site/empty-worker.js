// Minimal entry point for the Workers static-assets deployment. The assets are served
// directly by the platform; this worker adds no runtime behavior.
export default {
  async fetch() {
    return new Response('Engaz Reports Portal', { status: 200 });
  },
};
