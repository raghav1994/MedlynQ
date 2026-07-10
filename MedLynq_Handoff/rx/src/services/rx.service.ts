import fs from 'fs';
import path from 'path';
import { openai } from '../config/openai';

export interface MedicationEntry {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  whatItIs: string;
  whyPrescribed: string;
  keyTips: string[];
}

export interface DiagnosisEntry {
  original: string;
  plainEnglish: string;
}

export interface DecodedPrescription {
  patientInfo: {
    name: string;
    age: string;
    gender: string;
    date: string;
  };
  doctorInfo: {
    name: string;
    specialization: string;
    clinic: string;
    contact: string;
  };
  diagnoses: DiagnosisEntry[];
  medications: MedicationEntry[];
  tests: string[];
  doctorNotes: string;
  aiInsights: {
    overallCondition: string;
    importantWarnings: string[];
    lifestyleTips: string[];
    followUpSuggestions: string;
  };
}

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
  "patientInfo": {
    "name": "",
    "age": "",
    "gender": "",
    "date": ""
  },
  "doctorInfo": {
    "name": "",
    "specialization": "",
    "clinic": "",
    "contact": ""
  },
  "diagnoses": [
    {
      "original": "exact text from prescription",
      "plainEnglish": "what this means in simple terms"
    }
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

export async function decodePrescription(imagePath: string, mimeType: string): Promise<DecodedPrescription> {
  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString('base64');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: 'Please decode this prescription and return the structured JSON.',
          },
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content ?? '{}';
  // Strip markdown fences if model wraps in them
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned) as DecodedPrescription;
}
