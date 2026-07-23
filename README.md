# phosphor

Static portfolio served by a Cloudflare Worker with static assets.

- `public/` is the served directory. Everything in it is public.
- `wrangler.jsonc` sits outside it, so it is never uploaded or served.
- `public/_headers` is parsed by Workers for response headers; it is not served.

Deploy command in Workers Builds: `npx wrangler deploy`
Build command: leave empty.
