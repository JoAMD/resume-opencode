import axios from 'axios';

const TECTONIC_URL = process.env.TECTONIC_URL || 'http://localhost:4000/compile';

export async function compilePDF(latexSource: string): Promise<Buffer> {
  const response = await axios.post<ArrayBuffer>(TECTONIC_URL, latexSource, {
    headers: { 'Content-Type': 'text/plain' },
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  if (response.status !== 200) {
    throw new Error(`Tectonic compile failed with status ${response.status}`);
  }

  return Buffer.from(response.data);
}
