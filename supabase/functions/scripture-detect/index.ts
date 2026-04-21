// Scripture reference detector — uses Lovable AI to normalize spoken text
// into a canonical Bible reference. Returns null when no reference is found.
// Designed to be called sparingly: client should pre-filter with a keyword
// regex before invoking, to keep credit usage low.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You extract Bible scripture references from imperfect speech transcripts.
The speakers are Kenyan English speakers — expect accent-based mistranscriptions
(e.g. "Jon" -> "John", "Romance" -> "Romans", "first Corinthian" -> "1 Corinthians",
"sam" -> "Psalm", "revelations" -> "Revelation").

Rules:
- Return a normalized canonical reference like "John 3:16" or "1 Corinthians 13:4-7".
- Use standard English book names (Genesis, Exodus, ... Revelation). Use "1 ", "2 ", "3 " prefixes (not "First").
- Only return a reference if you are confident the speaker is citing scripture.
- If the transcript mentions a chapter only (e.g. "John chapter 3"), return "John 3".
- If nothing is a clear scripture citation, return found=false.`;

type Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const TOOL: Tool = {
  type: "function",
  function: {
    name: "report_reference",
    description: "Report at most one Bible reference detected in the transcript.",
    parameters: {
      type: "object",
      properties: {
        found: {
          type: "boolean",
          description: "True only if a clear scripture reference is present.",
        },
        book: {
          type: "string",
          description: "Canonical English book name, e.g. 'John', '1 Corinthians', 'Psalm'.",
        },
        chapter: { type: "integer", minimum: 1 },
        verseStart: { type: "integer", minimum: 1 },
        verseEnd: { type: "integer", minimum: 1 },
        reference: {
          type: "string",
          description: "Human-readable reference, e.g. 'John 3:16' or '1 Corinthians 13:4-7'.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Model confidence 0..1.",
        },
      },
      required: ["found"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript } = await req.json();
    if (typeof transcript !== "string" || transcript.trim().length < 4) {
      return new Response(JSON.stringify({ found: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Cheapest capable model — ideal for short classification calls
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript.slice(0, 600) },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "report_reference" } },
      }),
    });

    if (resp.status === 429) {
      return new Response(
        JSON.stringify({ error: "rate_limited" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (resp.status === 402) {
      return new Response(
        JSON.stringify({ error: "credits_exhausted" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      return new Response(JSON.stringify({ error: "ai_error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ found: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(call.function?.arguments ?? "{}");
    } catch (_) {
      parsed = {};
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scripture-detect error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
