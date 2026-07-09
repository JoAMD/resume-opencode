import { describe, it, expect } from 'vitest';
import { renderAtsAnalysisMarkdown } from './atsReport';
import { ATSAnalysisResult } from './types';

describe('renderAtsAnalysisMarkdown', () => {
  it('renders a minimal analysis with all sections', () => {
    const analysis: ATSAnalysisResult = {
      extractedFromJD: ['typescript', 'react', 'aws'],
      includedInResume: ['typescript', 'react'],
      missingFromResume: ['aws'],
      coveragePercent: 67,
      source: 'ai',
      model: 'openai/gpt-4o',
      strengths: ['Strong React + TypeScript experience demonstrated in the Acme Co role'],
      gaps: [
        {
          keyword: 'aws',
          why: 'The JD calls for AWS deployment experience as a core requirement.',
          suggestion: 'Add a bullet under the most recent role describing an AWS migration or deployment.',
        },
      ],
      recommendations: [
        'Lead the skills section with TypeScript and React to match the JD order.',
        'Add a quantified bullet demonstrating AWS usage.',
      ],
      summaryMarkdown: '## Summary\n\nThe resume is well aligned with the JD, with a clear gap in AWS.',
    };

    const md = renderAtsAnalysisMarkdown(analysis);

    expect(md).toContain('# ATS Analysis');
    expect(md).toContain('**Coverage:** 67%');
    expect(md).toContain('**Source:** ai (model: openai/gpt-4o)');
    expect(md).toContain('typescript, react');
    expect(md).toContain('aws');
    expect(md).toContain('## Strengths');
    expect(md).toContain('## Gaps & Suggestions');
    expect(md).toContain('**aws**');
    expect(md).toContain('Action: Add a bullet');
    expect(md).toContain('## Recommendations');
    expect(md).toContain('## Summary');
    expect(md).toContain('resume is well aligned');
  });

  it('omits model label when model is missing', () => {
    const md = renderAtsAnalysisMarkdown({
      extractedFromJD: ['go'],
      includedInResume: ['go'],
      missingFromResume: [],
      coveragePercent: 100,
      source: 'regex',
    });
    expect(md).toContain('**Source:** regex');
    expect(md).not.toContain('(model:');
  });

  it('renders fallback placeholders when arrays are empty', () => {
    const md = renderAtsAnalysisMarkdown({
      extractedFromJD: [],
      includedInResume: [],
      missingFromResume: [],
      coveragePercent: 100,
      source: 'regex',
    });
    expect(md).toContain('_none_');
    expect(md).toContain('No strengths highlighted.');
    expect(md).toContain('No specific gaps identified.');
    expect(md).toContain('No recommendations provided.');
  });

  it('falls back to regex-only summary when source is regex', () => {
    const md = renderAtsAnalysisMarkdown({
      extractedFromJD: ['go'],
      includedInResume: ['go'],
      missingFromResume: [],
      coveragePercent: 100,
      source: 'regex',
      summaryMarkdown: '_AI analysis disabled._',
    });
    expect(md).toContain('## Summary');
    expect(md).toContain('_AI analysis disabled._');
  });

  it('omits the Summary section when summaryMarkdown is missing/empty', () => {
    const md = renderAtsAnalysisMarkdown({
      extractedFromJD: ['go'],
      includedInResume: ['go'],
      missingFromResume: [],
      coveragePercent: 100,
      source: 'regex',
    });
    expect(md).not.toContain('## Summary');
  });
});
