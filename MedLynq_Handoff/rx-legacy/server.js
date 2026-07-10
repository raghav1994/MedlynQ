import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import OpenAI from 'openai';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const require    = createRequire(import.meta.url);
const pdfParse   = require('pdf-parse');

const app  = express();
const PORT = process.env.PORT ?? 4000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Upload ────────────────────────────────────────────────────────────────────
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (PDFs can be larger)
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED.includes(file.mimetype));
  },
});

// ── AI prompt ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a medical transcription assistant helping patients understand their prescriptions.

Your job is to:
1. Extract ALL information from the prescription EXACTLY as written — do not alter, guess, or fill in missing fields
2. Translate medical terms, drug names, and instructions into plain English ALONGSIDE the original text
3. Provide helpful context and inferences to help the patient understand their treatment

CRITICAL RULES:
- NEVER change, correct, or alter any prescription data (drug names, dosages, frequencies, diagnoses)
- If a field is not visible/present in the prescription, use an empty string ""
- Keep the original text verbatim, only add plain-English explanations in separate fields
- Your inferences should be general health education, not medical advice

Return ONLY a valid JSON object (no markdown fences) in exactly this shape:
{
  "patientInfo": { "name": "", "age": "", "gender": "", "date": "" },
  "doctorInfo":  { "name": "", "specialization": "", "clinic": "", "contact": "" },
  "diagnoses": [
    { "original": "exact text from prescription", "plainEnglish": "what this means in simple terms" }
  ],
  "medications": [
    {
      "name": "exact drug name as written",
      "dosage": "exact dosage as written",
      "frequency": "exact frequency as written",
      "duration": "exact duration as written",
      "instructions": "exact instructions as written (e.g. after meals)",
      "whatItIs": "plain English description of what this drug is",
      "whyPrescribed": "why this drug is typically used for this condition",
      "keyTips": ["tip 1", "tip 2"]
    }
  ],
  "tests": ["any lab tests or investigations ordered"],
  "doctorNotes": "any additional notes exactly as written",
  "aiInsights": {
    "overallCondition": "brief plain-English summary of what condition is being treated",
    "importantWarnings": ["any important warnings or drug interactions to be aware of"],
    "lifestyleTips": ["general lifestyle tips relevant to the condition"],
    "followUpSuggestions": "when to follow up or seek urgent care"
  }
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseAiResponse(content) {
  const cleaned = (content ?? '{}').replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

async function decodeFromImage(base64, mimeType) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
          { type: 'text', text: 'Please decode this prescription and return the structured JSON.' },
        ],
      },
    ],
  });
  return parseAiResponse(response.choices[0].message.content);
}

async function decodeFromText(text) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here is the full prescription text extracted from a PDF:\n\n${text}\n\nPlease decode this prescription and return the structured JSON.`,
      },
    ],
  });
  return parseAiResponse(response.choices[0].message.content);
}

// ── Decode endpoint ───────────────────────────────────────────────────────────
app.post('/api/rx/decode', upload.single('prescription'), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded. Please attach a prescription image or PDF.' });
  }

  try {
    let data;

    if (file.mimetype === 'application/pdf') {
      // ── PDF path ────────────────────────────────────────────────────────────
      const buffer  = fs.readFileSync(file.path);
      const pdfData = await pdfParse(buffer);
      const text    = pdfData.text?.trim() ?? '';

      if (text.length < 30) {
        // Scanned/image-only PDF — fall back to GPT-4o vision on the raw bytes
        // pdf-parse can't extract text from image PDFs, so we encode the PDF
        // as base64 and let the model handle it via the vision endpoint.
        // Note: GPT-4o doesn't natively render PDFs, so we surface a clear hint.
        return res.status(422).json({
          error:
            'This PDF appears to be a scanned image (no selectable text found). ' +
            'Please take a photo of the prescription and upload that instead — ' +
            'it will give better results.',
        });
      }

      data = await decodeFromText(text);
    } else {
      // ── Image path ──────────────────────────────────────────────────────────
      const base64 = fs.readFileSync(file.path).toString('base64');
      data = await decodeFromImage(base64, file.mimetype);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('[RX decode error]', err?.message ?? err);
    res.status(500).json({ error: 'Failed to decode prescription. Please try again.' });
  } finally {
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  MedLynq Rx Decoder running → http://localhost:${PORT}\n`);
});
