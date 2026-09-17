// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";

const MODELS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
];

function parseJson(text: string) {
  if (!text) return { error: "empty" };
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const s = t.slice(i, j + 1);
    try {
      return JSON.parse(s);
    } catch {}
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {}
  }
  return { error: "parse_fail", raw_text: t.slice(0, 800) };
}

async function callGemini(apiKey: string, body: unknown) {
  let last = "";
  for (const model of MODELS) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 429) {
      last = await res.text();
      continue;
    }
    if (!res.ok) {
      last = await res.text();
      if (res.status === 400 || res.status === 503) continue;
      throw new Error(`Gemini ${res.status}: ${last.slice(0, 200)}`);
    }
    const data = await res.json();
    return { data, model };
  }
  throw new Error("Semua model gagal: " + last.slice(0, 200));
}

console.info("grade function loaded");

export default {
  // publishable = anon key dari frontend boleh memanggil
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    };

    try {
      // Secret dari Dashboard → Edge Functions → Secrets
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        return Response.json(
          { error: "GEMINI_API_KEY belum di-set di Secrets" },
          { status: 500, headers: cors },
        );
      }

      if (req.method !== "POST") {
        return Response.json({ error: "POST only" }, { status: 405, headers: cors });
      }

      const payload = await req.json();
      const keys = payload.keys || [];
      const students = payload.students || [];
      if (!students.length) {
        return Response.json({ error: "students kosong" }, { status: 400, headers: cors });
      }

      const parts: unknown[] = [];
      const prompt =
        `Kamu guru multi-bahasa (dunia & daerah). Baca cetakan/tulisan tangan, foto miring/portrait/landscape. Jika tidak terbaca: nama="Tidak terbaca", score=0, isi missing. Nilai lembar siswa vs soal/kunci.
Balas HANYA JSON valid:
{"meta":{"sekolah":"","kelas":"","tanggal":"","mapel":""},"siswa":[{"nama":"","kelas":"","file":"","score":0,"pg":{"benar":0,"total":0,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":100}]},"essay":{"skor_total":0,"skor_maks":100,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":80}]}}],"missing":[],"ringkasan":""}
Jika file kunci adalah soal (bukan kunci), gunakan pengetahuan guru.
${payload.onlineKey ? "Gunakan second opinion pengetahuanmu." : ""}`;

      parts.push({ text: prompt });
      for (const f of keys) {
        parts.push({ text: `\n--- KUNCI/SOAL: ${f.name} ---\n` });
        parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });
      }
      for (const f of students) {
        parts.push({ text: `\n--- LEMBAR SISWA: ${f.name} ---\n` });
        parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });
      }

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      };

      const { data, model } = await callGemini(apiKey, body);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = parseJson(text);
      (parsed as Record<string, unknown>)._usedModel = model;

      if (!(parsed as { siswa?: unknown }).siswa && (parsed as { data?: { siswa?: unknown } }).data?.siswa) {
        Object.assign(parsed, (parsed as { data: object }).data);
      }
      if (!(parsed as { siswa?: unknown }).siswa) {
        return Response.json(
          { error: "parse_fail", model, raw: text.slice(0, 500) },
          { status: 422, headers: cors },
        );
      }

      return Response.json(parsed, { headers: cors });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500, headers: cors });
    }
  }),
};
