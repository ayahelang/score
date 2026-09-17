// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";

// Model aktif (Sept 2026)
const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];

function parseJson(text: string) {
  if (!text) return { error: "empty" };
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const s = t.slice(i, j + 1);
    try { return JSON.parse(s); } catch {}
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch {}
  }
  return { error: "parse_fail", raw_text: t.slice(0, 800) };
}

async function callGemini(apiKey: string, body: unknown) {
  const errors: string[] = [];
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) {
        errors.push(`${model}: ${res.status} ${raw.slice(0, 120)}`);
        continue;
      }
      const data = JSON.parse(raw);
      return { data, model };
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("Semua model gagal:\n" + errors.join("\n"));
}

console.info("grade function loaded");

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, _ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    };

    try {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        return Response.json({ error: "GEMINI_API_KEY belum di-set di Secrets" }, { status: 500, headers: cors });
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
      const prompt = `Kamu guru multi-bahasa (dunia & daerah). Baca cetakan/tulisan tangan, foto miring/portrait/landscape. Jika tidak terbaca: nama="Tidak terbaca", score=0, isi missing. Nilai lembar siswa vs soal/kunci.
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
      const parsed = parseJson(text) as Record<string, unknown>;
      parsed._usedModel = model;

      if (!parsed.siswa && (parsed.data as { siswa?: unknown })?.siswa) {
        Object.assign(parsed, parsed.data);
      }
      if (!parsed.siswa) {
        return Response.json(
          { error: "parse_fail", model, raw: String(text).slice(0, 500) },
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
