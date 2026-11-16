const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testOutputDim() {
  const apiKey = process.env.GEMINI_API_KEY.trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: 'StudyReader document intelligence testing vector 768' }] },
      outputDimensionality: 768
    })
  });
  const data = await res.json();
  if (data.embedding?.values) {
    console.log('SUCCESS: gemini-embedding-001 produced', data.embedding.values.length, 'dimensions!');
  } else {
    console.log('Response:', data);
  }
}
testOutputDim();
