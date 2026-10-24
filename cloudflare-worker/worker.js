const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AI_MODEL = 'openai/gpt-oss-120b';

async function handleAssistant(request, env, origin, allowedOrigin) {
  let body;
  try { body = await request.json(); }
  catch (_) { return json({ error: 'Send a valid JSON request.' }, 400, origin, allowedOrigin); }

  const action = String(body.action || '').trim();
  const message = String(body.message || body.text || '').trim();
  if (!['universal-capture', 'recall', 'activities-organize', 'life-organize', 'pulse-reflection', 'plan'].includes(action)) {
    return json({ error: 'Unsupported assistant action.' }, 400, origin, allowedOrigin);
  }
  if (!message) return json({ error: 'Please provide a message.' }, 400, origin, allowedOrigin);
  if (message.length > 12000) return json({ error: 'Message is too long (12,000 characters maximum).' }, 413, origin, allowedOrigin);

  const context = body.context && typeof body.context === 'object' ? body.context : Object.fromEntries(Object.entries(body).filter(([k]) => !['action','message'].includes(k)));
  const system = action === 'universal-capture'
    ? "You classify entries for Project-US. Return JSON only: {items:[{destination,type,title,text,subtitle,section,month,scheduleDate,scheduleTime,category,frequency,confidence,clarification}]}. Destinations: life_item, shared_activity, todo, routine, clarify. Existing Our Life types: Prophecy, Confession, Faith Project, Testimony, Church Takeaway, Intercessory Focus, Vision Board, Role Model. Use Church Takeaway for after-church learnings. Prayer Focus uses a special weekday form: clarify instead. Existing shared types: Book, Message, Conversation, Agreement, Prayer, Topic, Shared activity, Review period. Preserve original words in text, especially spiritual notes. Never invent dates, tabs, categories or commitments. Use clarify if uncertain. Return up to 10 items. Never save."
    : action === 'activities-organize'
    ? "Organize a couple's shared activity idea. Return JSON {suggestion:{title,type,subtitle,month,scheduleDate,section}}. Allowed types: Book, Message, Conversation, Agreement, Prayer, Topic, Shared activity, Review period. section journey or general. Do not invent dates or commitments. Never save."
    : action === 'life-organize'
    ? "Suggest metadata for a personal life entry. Return JSON {suggestion:{title,type,actionPoints}}. Suggest type only from allowedTypes. Never rewrite or summarize the original text, especially prayers, prophecies, confessions and testimonies. Never save."
    : action === 'pulse-reflection'
    ? "Write a gentle reflection using only supplied activity counts. Return JSON {reflection:string}, under 160 words. Do not shame, rank, diagnose or assume feelings. Never save."
    : action === 'plan'
    ? "Help plan tasks. Return JSON {tasks:[{title,type,duration_minutes,frequency,category,missing_information}]}. type routine or small-todo; frequency daily, weekdays, weekly, or project. Avoid duplicates from existing routines/todos. One-off tasks are small-todo unless recurrence is explicit. Do not save."
    : "Answer questions only from supplied saved-record context. Return JSON {action:'recall',answer:string,sources:[{collection,id,title,excerpt}]}. Do not invent facts. If evidence is missing, say you couldn't find it.";
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
      ...parsed,
      action: ['capture', 'recall', 'clarify'].includes(parsed.action) ? parsed.action : (action === 'recall' ? 'recall' : 'capture'),
      answer: String(parsed.answer || '').slice(0, 5000),
      clarification: typeof parsed.clarification === 'string' ? parsed.clarification.slice(0, 500) : null,
      proposals, sources,
      items: Array.isArray(parsed.items) ? parsed.items.slice(0, 10) : undefined,
      suggestion: parsed.suggestion && typeof parsed.suggestion === 'object' ? parsed.suggestion : undefined,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 20) : undefined,
      reflection: typeof parsed.reflection === 'string' ? parsed.reflection.slice(0, 1800) : undefined
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

    if (new URL(request.url).pathname.replace(/\/$/, '') === '/plan') {
      const body = await request.json();
      return handleAssistant(new Request(request.url.replace(/\/$/, '') + '/assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({ action: 'plan', text: body.text, context: { existing_routines: body.existing_routines || [], existing_todos: body.existing_todos || [] } })
      }), env, origin, allowedOrigin);
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
