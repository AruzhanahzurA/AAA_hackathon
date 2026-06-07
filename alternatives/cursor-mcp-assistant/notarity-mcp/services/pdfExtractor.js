import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.join(__dirname, '..', '..');

const EXTRACTION_PROMPT = `Extract only the Notarity booking fields explicitly present in this PDF. Return JSON only.

Target fields:
- destinationCountry
- billingDetails.firstName, billingDetails.lastName, billingDetails.email, billingDetails.phoneNumber, billingDetails.address, billingDetails.city, billingDetails.zipCode, billingDetails.countryCode
- contactDetails.firstName, contactDetails.lastName, contactDetails.email
- participants[]
- products[] (product names or ids if visible)
- hardCopy.hardCopy, hardCopy.expressShipping
- shippingDetails.address, shippingDetails.city, shippingDetails.zipCode, shippingDetails.countryCode
- preferredNotary
- newsletter

Rules:
- omit uncertain fields
- do not invent values`;

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)```/i);
    return match ? JSON.parse(match[1]) : { raw: text };
  }
}

export function resolvePdfPath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(WORKSPACE_ROOT, filePath);
}

async function extractFromBase64(base64Pdf) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: 'You are an extraction engine for Notarity appointment requests. Return valid JSON only.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const text = response.content?.[0]?.text || '';
  return parseJsonSafely(text);
}

export async function extractPdfFields({ filePath, base64, filename } = {}) {
  if (base64) {
    return extractFromBase64(base64);
  }

  if (!filePath) {
    throw new Error('Provide filePath or base64 for the PDF.');
  }

  const resolvedPath = resolvePdfPath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`PDF not found: ${resolvedPath}${filename ? ` (${filename})` : ''}`);
  }

  const pdfBuffer = fs.readFileSync(resolvedPath);
  return extractFromBase64(pdfBuffer.toString('base64'));
}
