import { describe, it, expect, beforeEach } from 'vitest';
import { buildFolderPath, parseSeekInput } from './utils';

describe('buildFolderPath', () => {
  it('should return jobsPath + / + jobDir', () => {
    expect(buildFolderPath('/home/user/jobs', 'shopify-swe')).toBe('/home/user/jobs/shopify-swe');
  });

  it('should handle empty jobsPath', () => {
    expect(buildFolderPath('', 'shopify-swe')).toBe('/shopify-swe');
  });

  it('should handle null jobsPath', () => {
    expect(buildFolderPath(null as any, 'shopify-swe')).toBe('/shopify-swe');
  });

  it('should handle jobsPath with trailing slash', () => {
    expect(buildFolderPath('/home/user/jobs/', 'shopify-swe')).toBe('/home/user/jobs//shopify-swe');
  });

  it('should handle jobDir with special characters', () => {
    expect(buildFolderPath('/home/user/jobs', 'shopify-swe-v2.0')).toBe('/home/user/jobs/shopify-swe-v2.0');
  });
});

describe('parseSeekInput', () => {
  it('should parse role and company from SEEK listing', () => {
    const input = `Senior Software Engineer
Acme Pty Ltd
We are looking for a senior software engineer to join our team.
About the role
Build scalable web applications using React and Node.js.
About our client
Acme is a leading tech company.`;
    const result = parseSeekInput(input);
    expect(result.role).toBe('Senior Software Engineer');
    expect(result.company).toBe('Acme Pty Ltd');
    expect(result.jobDescription).toContain('Build scalable web applications');
  });

  it('should skip bank warning text', () => {
    const input = `Software Engineer
Tech Corp
Build great software.
Don't provide your bank details here.
This should be skipped.
About our client`;
    const result = parseSeekInput(input);
    expect(result.jobDescription).not.toContain("don't provide your bank");
    expect(result.jobDescription).not.toContain('This should be skipped');
  });

  it('should skip common SEEK phrases', () => {
    const input = `QA Engineer
Test Company
About our client
We are a great company.
About the role
You will test software.
Requirements
Must have 5 years experience.
What's on offer
Competitive salary.
Report this job
Report if suspicious.
Be careful with job scams.
Was this skills match accurate
Help us match better.
We match your skills and credentials
Hide all
Actual job content here.
About our client`;
    const result = parseSeekInput(input);
    expect(result.jobDescription).not.toContain('About our client');
    expect(result.jobDescription).not.toContain('About the role');
    expect(result.jobDescription).not.toContain('Requirements');
    expect(result.jobDescription).not.toContain("What's on offer");
    expect(result.jobDescription).not.toContain('Report this job');
    expect(result.jobDescription).not.toContain('Be careful');
    expect(result.jobDescription).not.toContain('We match your skills');
  });

  it('should handle role title only mode (no JD needed)', () => {
    const input = `Senior DevOps Engineer`;
    const result = parseSeekInput(input);
    expect(result.role).toBe('Senior DevOps Engineer');
    expect(result.company).toBe('');
  });

it('should skip posted dates in role/company detection', () => {
    const input = `Backend Engineer
Company Group
3d ago
Some job content here.
About our client`;
    const result = parseSeekInput(input);
    expect(result.role).toBe('Backend Engineer');
    expect(result.company).toBe('Company Group');
    expect(result.jobDescription).toBe('3d ago\n\nSome job content here.');
  });
});