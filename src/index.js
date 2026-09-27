// The portfolio moved to portfolio.sunterresa.workers.dev.
// Anything still pointing at the old address (earlier resumes, old shares)
// lands on the same path at the new one. 301 so search engines follow too.
const TARGET = 'https://portfolio.sunterresa.workers.dev';

export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(TARGET + url.pathname + url.search, 301);
  },
};
