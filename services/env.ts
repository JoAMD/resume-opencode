export interface EnvResumeProfile {
  fullName: string;
  phone: string;
  email: string;
  linkedinUrl: string;
  linkedinDisplay: string;
  education: {
    institution: string;
    location: string;
    degree: string;
    dates: string;
  }[];
}

export const DEFAULT_PROFILE: EnvResumeProfile = {
  fullName: '[Your Name]',
  phone: '[your phone]',
  email: '[your email]',
  linkedinUrl: 'https://linkedin.com/in/[your-handle]',
  linkedinDisplay: 'linkedin.com/in/[your-handle]',
  education: [
    {
      institution: 'Institute 1',
      location: 'Location',
      degree: 'Masters',
      dates: 'Feb 2023 - Dec 2024',
    },
    {
      institution: 'Institute 2',
      location: 'Location',
      degree: 'B.Tech',
      dates: '2017 - 2021',
    },
  ],
};

function asDisplayFromUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function normalizeEnvProfile(input?: Partial<EnvResumeProfile>): EnvResumeProfile {
  const firstEdu: Partial<EnvResumeProfile['education'][number]> = input?.education?.[0] ?? {};
  const secondEdu: Partial<EnvResumeProfile['education'][number]> = input?.education?.[1] ?? {};
  const linkedinUrl = (input?.linkedinUrl ?? '').trim() || DEFAULT_PROFILE.linkedinUrl;

  return {
    fullName: (input?.fullName ?? '').trim() || DEFAULT_PROFILE.fullName,
    phone: (input?.phone ?? '').trim() || DEFAULT_PROFILE.phone,
    email: (input?.email ?? '').trim() || DEFAULT_PROFILE.email,
    linkedinUrl,
    linkedinDisplay: (input?.linkedinDisplay ?? '').trim() || asDisplayFromUrl(linkedinUrl),
    education: [
      {
        institution: (firstEdu.institution ?? '').trim() || DEFAULT_PROFILE.education[0].institution,
        location: (firstEdu.location ?? '').trim() || DEFAULT_PROFILE.education[0].location,
        degree: (firstEdu.degree ?? '').trim() || DEFAULT_PROFILE.education[0].degree,
        dates: (firstEdu.dates ?? '').trim() || DEFAULT_PROFILE.education[0].dates,
      },
      {
        institution: (secondEdu.institution ?? '').trim() || DEFAULT_PROFILE.education[1].institution,
        location: (secondEdu.location ?? '').trim() || DEFAULT_PROFILE.education[1].location,
        degree: (secondEdu.degree ?? '').trim() || DEFAULT_PROFILE.education[1].degree,
        dates: (secondEdu.dates ?? '').trim() || DEFAULT_PROFILE.education[1].dates,
      },
    ],
  };
}

export function parseDotEnvContent(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

export function buildProfileFromEnvVars(envVars: Record<string, string>): EnvResumeProfile {
  return normalizeEnvProfile({
    fullName: envVars.RESUME_NAME,
    phone: envVars.RESUME_PHONE,
    email: envVars.RESUME_EMAIL,
    linkedinUrl: envVars.RESUME_LINKEDIN_URL,
    linkedinDisplay: envVars.RESUME_LINKEDIN_DISPLAY,
    education: [
      {
        institution: envVars.EDU1_INSTITUTION,
        location: envVars.EDU1_LOCATION,
        degree: envVars.EDU1_DEGREE,
        dates: envVars.EDU1_DATES,
      },
      {
        institution: envVars.EDU2_INSTITUTION,
        location: envVars.EDU2_LOCATION,
        degree: envVars.EDU2_DEGREE,
        dates: envVars.EDU2_DATES,
      },
    ],
  });
}

export function formatEducationLine(entry: EnvResumeProfile['education'][number]): string {
  return `${entry.institution}, ${entry.location} | ${entry.degree} | ${entry.dates}`;
}