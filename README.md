# phosphor

Static portfolio served by a Cloudflare Worker with static assets.
No build step, no dependencies, no third-party requests at runtime.

## Structure

    wrangler.jsonc            worker config. sits OUTSIDE public/ so it is never served
    public/                   the served directory - everything in here is public
      index.html              markup shell. no inline script or style
      assets/
        content.js            >>> THE ONLY FILE YOU EDIT <<<
        app.js                the engine. holds no content, needs no changes
        styles.css            design tokens + layout
        fonts/*.woff2         self-hosted, subset (28 KB total)
      _headers                security headers, parsed by Workers, not served
      favicon.svg
      robots.txt
      .well-known/security.txt

## Adding a project

Everything lives in `public/assets/content.js`:

1. append an object to `findings`
2. optionally append one to `demos` - the replay player builds its own
   tabs, stage bar, heading and link from whatever is there
3. optionally append to `commands` for a console command

Field reference and the demo step vocabulary are documented at the top
of that file.

## Deploy

Workers Builds, connected to Git:

    Build command   (leave empty)
    Deploy command  npx wrangler deploy

## Verify after deploy

    curl -sI https://<your-domain> | grep -iE 'content-security|strict-transport|permissions'
