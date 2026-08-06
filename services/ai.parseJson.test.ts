import { describe, it, expect } from 'vitest';
import { parseJSONFromResponse } from './ai';

describe('parseJSONFromResponse', () => {
  it('parses plain JSON', () => {
    expect(parseJSONFromResponse('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences at boundaries', () => {
    expect(parseJSONFromResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts JSON from code block after reasoning text', () => {
    const text = `Let me analyze the resume.

**Keywords to check:**
1. agile
2. apis

\`\`\`json
{
  "includedInResume": ["apis", "docker"],
  "missingFromResume": ["agile"]
}
\`\`\``;
    const result = parseJSONFromResponse(text);
    expect(result).toEqual({
      includedInResume: ['apis', 'docker'],
      missingFromResume: ['agile'],
    });
  });

  it('takes last code block when multiple exist', () => {
    const text = `First block:
\`\`\`json
{"stale": true}
\`\`\`

Second block:
\`\`\`json
{"correct": true}
\`\`\``;
    expect(parseJSONFromResponse(text)).toEqual({ correct: true });
  });

  it('returns empty object when no JSON found', () => {
    expect(parseJSONFromResponse('no json here')).toEqual({});
  });
});
