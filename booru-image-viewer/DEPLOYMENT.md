# Deploying Booru Image Viewer — Free & Permanent

This guide walks you through deploying the app to **Vercel's free tier**, which
never expires for personal use. The whole process takes about 2 minutes.

---

## Why Vercel?

- **Free forever** for personal/hobby projects
- **Zero config** for Next.js (it's made by the same company)
- **Automatic HTTPS** — your site gets a valid SSL certificate
- **Global CDN** — fast worldwide
- **Custom domain** support (optional)
- The app's server-side API routes (`/api/booru` and `/api/image`) work
  out-of-the-box because Vercel supports Node.js serverless functions

---

## Option A: Deploy via Vercel Dashboard (recommended, ~2 min)

### Step 1 — Get the code

Download `booru-image-viewer.zip` from this project's download folder and
unzip it anywhere on your computer.

### Step 2 — Create a GitHub repo

1. Go to https://github.com/new
2. Name it `booru-image-viewer` (or whatever you like)
3. Set it to **Public** or **Private** (either works)
4. Click **Create repository**
5. Drag-and-drop the unzipped files into the GitHub upload page, then commit

### Step 3 — Deploy on Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New** → **Project**
3. Import your `booru-image-viewer` repo
4. Vercel auto-detects Next.js — **don't change any settings**
5. Click **Deploy**
6. Wait ~60 seconds for the build to finish
7. You'll get a permanent URL like `https://booru-image-viewer.vercel.app`

That's it. The site is now live and will stay live.

---

## Option B: Deploy via Vercel CLI (~1 min, if you have Node.js)

```bash
# Install Vercel CLI once
npm i -g vercel

# From the unzipped project folder:
vercel

# Answer the prompts (press Enter to accept defaults):
#   - Set up and deploy? Y
#   - Which scope? (your account)
#   - Link to existing project? N
#   - Project name? booru-image-viewer
#   - In which directory? ./
#   - Want to modify settings? N

# After the preview deploy succeeds, deploy to production:
vercel --prod
```

You'll get a permanent `https://booru-image-viewer.vercel.app` URL.

---

## Option C: Other free hosts

| Host | Works? | Notes |
|------|--------|-------|
| **Vercel** | ✅ | Best option — native Next.js support |
| **Netlify** | ✅ | Add `@netlify/plugin-nextjs` |
| **Cloudflare Pages** | ⚠️ | Works but requires `@cloudflare/next-on-pages` and the API routes need adjustment (Cloudflare Workers don't support all Node.js APIs) |
| **Railway** | ✅ | Free tier, runs as a normal Node.js app |
| **Render** | ✅ | Free tier, runs as a Node.js service |
| **Self-hosted VPS** | ✅ | Run `bun run build && bun run start` on any VPS |

---

## After deployment

- Your API key and bookmarks are stored in **your browser's localStorage**,
  so they're per-device. They don't travel between browsers.
- The `/api/booru` and `/api/image` routes run as serverless functions on
  Vercel. They have a 30-second timeout per request (configured in
  `vercel.json`), which is plenty for booru API calls.
- Vercel's free hobby tier gives you 100GB of bandwidth per month — more
  than enough for personal browsing.

## Updating the site later

Just push a new commit to your GitHub repo. Vercel automatically rebuilds
and deploys within ~60 seconds.

---

## Custom domain (optional)

In the Vercel dashboard → your project → **Settings** → **Domains**, add
a custom domain you own. Vercel handles the SSL certificate automatically.
