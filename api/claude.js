export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Grab the secret key from Vercel Environment Variables
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("Vercel Server: ANTHROPIC_API_KEY is missing.");
    return new Response(JSON.stringify({ error: 'Check your ANTHROPIC_API_KEY in Vercel' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 3. Read the incoming request body from your frontend
    const body = await req.text();

    // 4. Forward the request to Anthropic securely
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: body,
    });

    // 5. Send Anthropic's exact response (or error) back to your frontend
    const data = await anthropicRes.text();
    return new Response(data, {
      status: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Serverless Function Error:", error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
