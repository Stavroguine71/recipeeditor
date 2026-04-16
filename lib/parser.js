// Extracts raw text from an uploaded file (PDF / DOCX / image)
// and then asks the LLM to structure it into a recipe object.
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { structureRecipe, visionExtractRecipe } = require('./ai');

function extFromName(filename) {
  return path.extname((filename || '').toLowerCase());
}

async function extractPdf(buf) {
  const data = await pdfParse(buf);
  return data.text || '';
}

async function extractDocx(buf) {
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value || '';
}

async function extractImageOcr(buf) {
  // tesseract.js is heavy — only require it when we actually need OCR.
  const Tesseract = require('tesseract.js');
  const { data } = await Tesseract.recognize(buf, 'eng');
  return data.text || '';
}

/**
 * Parse an uploaded file into a structured recipe.
 * Returns { title, description, servings, ingredients[], steps[], notes, rawText }
 */
async function parseUpload({ buffer, originalName, mimeType }) {
  const ext = extFromName(originalName);
  let rawText = '';
  let usedVision = false;
  let structured = null;

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    rawText = await extractPdf(buffer);
  } else if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    rawText = await extractDocx(buffer);
  } else if (ext === '.doc') {
    throw new Error('Legacy .doc files are not supported — please save as .docx.');
  } else if (
    ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext) ||
    (mimeType && mimeType.startsWith('image/'))
  ) {
    // Prefer Claude vision when available — far better at handwritten / stylized recipes.
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        structured = await visionExtractRecipe(buffer, mimeType || 'image/jpeg');
        usedVision = true;
        rawText = '[extracted via vision]';
      } catch (err) {
        console.warn('[parser] vision extraction failed, falling back to OCR:', err.message);
      }
    }
    if (!usedVision) {
      rawText = await extractImageOcr(buffer);
    }
  } else {
    // Best-effort: try as plain text
    rawText = buffer.toString('utf8');
  }

  if (!structured) {
    if (!rawText || rawText.trim().length < 20) {
      throw new Error('Could not extract readable text from the file.');
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      // Minimal fallback: dump everything into notes so nothing is lost.
      structured = {
        title: path.basename(originalName || 'Untitled recipe', ext),
        description: '',
        servings: '',
        ingredients: [],
        steps: [],
        notes: rawText.trim(),
      };
    } else {
      structured = await structureRecipe(rawText);
    }
  }

  return { ...structured, rawText };
}

module.exports = { parseUpload };
