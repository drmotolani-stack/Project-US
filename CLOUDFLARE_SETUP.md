# Project-US AI Dictation — Groq + Whisper

This edition replaces Project-US's browser speech-recognition dictation with a recording → Groq Whisper → transcript flow.

## What is included

- `index.html` — existing Project-US app with AI Dictate integrated into the existing text-entry fields.
- `cloudflare-worker/worker.js` — small secure proxy. The Groq API key is stored as a Cloudflare secret, not in GitHub.
- Existing Firebase and voice-note code is otherwise retained.

## One-time setup

### 1. Create a Groq account and API key

Go to the Groq console:

https://console.groq.com/

Create/sign in to your account, then create an API key. **Do not paste the key into `index.html` or commit it to GitHub.**

### 2. Create a Cloudflare Worker

Go to:

https://dash.cloudflare.com/

Create a Worker and paste the complete contents of:

`cloudflare-worker/worker.js`

Deploy it.

### 3. Add two Worker secrets

In the Worker settings, add these secrets:

- `GROQ_API_KEY` = the Groq API key you created.
- `ALLOWED_ORIGIN` = the exact public URL where Project-US is hosted.

For example, if GitHub Pages opens Project-US at:

`https://yourusername.github.io/Project-US/`

the value should be:

`https://yourusername.github.io`

Do not include the `/Project-US/` path.

### 4. Copy the Worker URL

Cloudflare will give the Worker a URL similar to:

`https://project-us-transcribe.your-subdomain.workers.dev`

Open `index.html` and find:

`window.PROJECT_US_TRANSCRIBE_URL = window.PROJECT_US_TRANSCRIBE_URL || 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE';`

Replace only the placeholder with your Worker URL.

Example:

`window.PROJECT_US_TRANSCRIBE_URL = window.PROJECT_US_TRANSCRIBE_URL || 'https://project-us-transcribe.example.workers.dev';`

Do not add a trailing slash.

### 5. Test before replacing the live site

Upload/deploy this updated Project-US version somewhere safe first if possible.

Open an activity that has **AI Dictate**, tap it, speak, tap **Stop & transcribe**, and wait for the transcript.

The transcript is appended to any text already in the field; it does not replace existing text.

## Important

The Worker intentionally rejects requests from websites other than the exact `ALLOWED_ORIGIN`. This keeps strangers from using your transcription endpoint and consuming your Groq allowance.

Groq currently documents `whisper-large-v3` as its accuracy-focused multilingual Whisper option. Its current free-tier direct-upload limit is 25 MB per audio file. See Groq's current documentation for limits and pricing.

The frontend records using the browser's `MediaRecorder` API, but **the browser is not doing the speech recognition**. The audio is sent to the Worker and transcribed by Groq-hosted Whisper.

If you later want a faster/cheaper model, the Worker can be changed from `whisper-large-v3` to `whisper-large-v3-turbo` without changing the Project-US frontend.
