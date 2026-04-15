export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("Vercel Server: ANTHROPIC_API_KEY is missing.");
    return new Response(JSON.stringify({ error: 'Check your ANTHROPIC_API_KEY in Vercel' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.text();

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: body,
    });

    return new Response(anthropicRes.body, {
      status: anthropicRes.status,
      headers: { 
        'Content-Type': anthropicRes.headers.get('Content-Type') || 'application/json' 
      },
    });

  } catch (error) {
    console.error("Serverless Function Error:", error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
