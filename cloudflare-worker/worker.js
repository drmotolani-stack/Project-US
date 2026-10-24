const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AI_MODEL = 'openai/gpt-oss-120b';

async function handleAssistant(request, env, origin, allowedOrigin) {
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: 'Send a valid JSON request.' }, 400, origin, allowedOrigin); }

  const action = String(body.action || '').trim();
  const message = String(body.message || '').trim();
  if (!['universal-capture', 'recall'].includes(action)) {
    return json({ error: 'Unsupported assistant action.' }, 400, origin, allowedOrigin);
  }
  if (!message) return json({ error: 'Please provide a message.' }, 400, origin, allowedOrigin);
  if (message.length > 12000) return json({ error: 'Message is too long (12,000 characters maximum).' }, 413, origin, allowedOrigin);

  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const system = `You are Project-US, a careful assistant for a couple's shared life-management app.
Use only the supplied app context; do not invent saved facts or claim something was saved.
Existing Firestore collections are life_items, shared_items, todos, routines, and entries.
Keep all existing categories; never create new categories. Preserve the user's original wording, especially spiritual, relationship, prophecy, confession, prayer, and testimony notes.
Never perform database changes. Return suggestions only; a human must approve all changes.
For action universal-capture, identify intent and suggest zero or more records. If unclear, ask one concise clarification question and do not guess.
For action recall, answer only from the supplied context and cite the relevant records by collection and id. If evidence is absent, say you couldn't find it.
Return valid JSON only, with this schema:
{"action":"capture|recall|clarify","answer":"short user-facing response","clarification":null,"proposals":[{"collection":"life_items|shared_items|todos|routines|entries","type":"existing type or null","title":"...","content":"original wording or faithful excerpt","fields":{},"reason":"why this destination fits"}],"sources":[{"collection":"...","id":"...","title":"...","excerpt":"..."}]}
Use empty arrays when there are no proposals or sources. Do not include markdown fences.`;
  const payload = {
    model: AI_MODEL,
    temperature: 0.1,
    max_completion_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ action, message, context }) }
    ]
  };

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw;
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch (_) {}
      return json({ error: `AI request failed: ${detail}` }, response.status, origin, allowedOrigin);
    }
    let parsed;
    try {
      const envelope = JSON.parse(raw);
      parsed = JSON.parse(envelope.choices?.[0]?.message?.content || '{}');
    } catch (_) {
      return json({ error: 'AI returned an invalid structured response. Please try again.' }, 502, origin, allowedOrigin);
    }
    const validCollections = new Set(['life_items', 'shared_items', 'todos', 'routines', 'entries']);
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.filter(p =>
      p && validCollections.has(p.collection) && typeof p.title === 'string'
    ).map(p => ({
      collection: p.collection,
      type: typeof p.type === 'string' ? p.type : null,
      title: p.title.slice(0, 240),
      content: typeof p.content === 'string' ? p.content.slice(0, 12000) : '',
      fields: p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields) ? p.fields : {},
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 500) : ''
    })) : [];
    const sources = Array.isArray(parsed.sources) ? parsed.sources.filter(s =>
      s && validCollections.has(s.collection) && typeof s.id === 'string'
    ).map(s => ({
      collection: s.collection, id: s.id,
      title: String(s.title || '').slice(0, 240),
      excerpt: String(s.excerpt || '').slice(0, 1200)
    })) : [];
    return json({
      action: ['capture', 'recall', 'clarify'].includes(parsed.action) ? parsed.action : (action === 'recall' ? 'recall' : 'capture'),
      answer: String(parsed.answer || '').slice(0, 5000),
      clarification: typeof parsed.clarification === 'string' ? parsed.clarification.slice(0, 500) : null,
      proposals, sources
    }, 200, origin, allowedOrigin);
  } catch (error) {
    console.error('Project-US assistant Worker error:', error);
    return json({ error: 'The Project-US assistant could not complete that request.' }, 500, origin, allowedOrigin);
  }
}


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

    if ((request.headers.get('Content-Type') || '').includes('application/json')) {
      return handleAssistant(request, env, origin, allowedOrigin);
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
