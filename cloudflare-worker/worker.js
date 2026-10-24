const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';

function corsHeaders(origin, allowedOrigin) {
  const allowed = allowedOrigin && origin === allowedOrigin ? origin : null;
  return {
    'Access-Control-Allow-Origin': allowed || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin, allowedOrigin)
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '';

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin || origin !== allowedOrigin) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin, allowedOrigin),
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, origin, allowedOrigin);
    }

    if (!allowedOrigin || origin !== allowedOrigin) {
      return json({ error: 'This Project-US transcription endpoint is not configured for this website.' }, 403, origin, allowedOrigin);
    }

    if (!env.GROQ_API_KEY) {
      return json({ error: 'GROQ_API_KEY is not configured on the Worker.' }, 500, origin, allowedOrigin);
    }

    try {
      const incoming = await request.formData();
      const file = incoming.get('file');

      if (!(file instanceof File)) {
        return json({ error: 'No audio file was provided.' }, 400, origin, allowedOrigin);
      }

      // Groq's free-tier upload limit is currently 25 MB.
      if (file.size > 25 * 1024 * 1024) {
        return json({ error: 'Audio file is larger than Groq’s 25 MB free-tier limit.' }, 413, origin, allowedOrigin);
      }

      const form = new FormData();
      form.append('file', file, file.name || 'project-us-dictation.webm');
      form.append('model', MODEL);
      form.append('language', 'en');
      form.append('temperature', '0');
      form.append('response_format', 'json');

      // Short context prompt helps Whisper spell app-specific names consistently.
      form.append(
        'prompt',
        'Project-US. Names and terms may include Motolani, Zusi, Omosusi, Project-US, Firebase, GitHub, Nigeria, Nigerian English, and Christian or relationship vocabulary. Transcribe faithfully; do not rewrite or summarize.'
      );

      const groqResponse = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`
        },
        body: form
      });

      const text = await groqResponse.text();

      if (!groqResponse.ok) {
        let detail = text;
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error?.message || parsed?.error || text;
        } catch (_) {}
        return json({ error: `Groq transcription failed: ${detail}` }, groqResponse.status, origin, allowedOrigin);
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch (_) {
        return json({ error: 'Groq returned an unexpected response.' }, 502, origin, allowedOrigin);
      }

      return json({ text: String(result.text || '').trim() }, 200, origin, allowedOrigin);
    } catch (error) {
      console.error('Project-US transcription Worker error:', error);
      return json({ error: 'The transcription service could not process this recording.' }, 500, origin, allowedOrigin);
    }
  }
};
