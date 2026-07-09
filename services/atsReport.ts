import { ATSAnalysisResult } from './types';

function joinList(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) return fallback;
  return items.map((s) => s.trim()).filter(Boolean).join(', ');
}

function bulletList(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) return `- ${fallback}`;
  return items.map((s) => `- ${s.trim()}`).filter(Boolean).join('\n');
}

function gapList(gaps: ATSAnalysisResult['gaps']): string {
  if (!gaps || gaps.length === 0) return '- No specific gaps identified.';
  return gaps
    .map((g) => {
      const keyword = (g.keyword || '').trim() || '(keyword)';
      const why = (g.why || '').trim() || 'Relevant to the JD.';
      const suggestion = (g.suggestion || '').trim() || 'Add a bullet demonstrating this skill.';
      return `- **${keyword}** — _${why}_\n  - Action: ${suggestion}`;
    })
    .join('\n');
}

export function renderAtsAnalysisMarkdown(analysis: ATSAnalysisResult): string {
  const lines: string[] = [];
  const source = analysis.source ?? 'regex';
  const modelLabel = analysis.model ? ` (model: ${analysis.model})` : '';

  lines.push(`# ATS Analysis`);
  lines.push('');
  lines.push(`**Coverage:** ${analysis.coveragePercent}%  `);
  lines.push(`**Source:** ${source}${modelLabel}  `);
  lines.push(`**Keywords from JD:** ${analysis.extractedFromJD.length}  `);
  lines.push(`**Included:** ${analysis.includedInResume.length}  `);
  lines.push(`**Missing:** ${analysis.missingFromResume.length}`);
  lines.push('');

  if (analysis.summaryMarkdown && analysis.summaryMarkdown.trim().length > 0) {
    lines.push('## Summary');
    lines.push('');
    lines.push(analysis.summaryMarkdown.trim());
    lines.push('');
  }

  lines.push('## Included Keywords');
  lines.push('');
  lines.push(joinList(analysis.includedInResume, '_none_'));
  lines.push('');

  lines.push('## Missing Keywords');
  lines.push('');
  lines.push(joinList(analysis.missingFromResume, '_none_'));
  lines.push('');

  lines.push('## Strengths');
  lines.push('');
  lines.push(bulletList(analysis.strengths, 'No strengths highlighted.'));
  lines.push('');

  lines.push('## Gaps & Suggestions');
  lines.push('');
  lines.push(gapList(analysis.gaps));
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  lines.push(bulletList(analysis.recommendations, 'No recommendations provided.'));
  lines.push('');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
