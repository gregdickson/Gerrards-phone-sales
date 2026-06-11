const config = require('../config');

/**
 * Transcribe an audio buffer using OpenAI Whisper API.
 * Returns the transcription text.
 */
async function transcribe(audioBuffer, filename = 'recording.mp3') {
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${error}`);
  }

  const data = await res.json();
  return data.text;
}

module.exports = { transcribe };
