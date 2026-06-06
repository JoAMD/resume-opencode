export function parseSeekInput(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let role = '';
  let company = '';
  let jobDesc = '';
  let foundCompany = false;
  let descriptionStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!role && i < 5 && !line.includes('SEEK') && !line.includes('Skip to') && line.length > 2 && line.length < 100) {
      const lower = line.toLowerCase();
      if (!lower.includes('view all') && !lower.includes('posted') && !line.match(/^\d+[a-z]+ ago$/)) {
        role = line;
      }
    }
    if (!company && (line.includes('Pty Ltd') || line.includes('Ltd') || line.includes('Group') || line.length > 3 && line.length < 80)) {
      const lower = line.toLowerCase();
      if (lower.includes('pty ltd') || lower.includes(' ltd') || lower.includes('group pty') || (lower.includes('group') && !lower.includes('view all'))) {
        company = line;
        foundCompany = true;
        descriptionStartIndex = i + 1;
        break;
      }
    }
  }
  const roleLineIndex = lines.indexOf(role);
  if (!company && foundCompany === false) {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i];
      if (line === role) continue;
      if (line && line.length > 3 && line.length < 60 && !line.match(/^(Contract|Temp|FullTime|PartTime|Permanent)/i) && !line.match(/^\$/) && !line.match(/^\d+[a-z]+ ago$/)) {
        const lower = line.toLowerCase();
        if (!lower.includes('seek') && !lower.includes('skip') && !lower.includes('view all') && !lower.includes('posted') && !line.match(/^\d+[\d,]* p\.\d/)) {
          company = line;
          descriptionStartIndex = i + 1;
          break;
        }
      }
    }
  }
  const descLines = lines.slice(descriptionStartIndex);
  const skipPhrases = ['About our client', 'About the role', 'Requirements', "What's on offer", 'Report this job', 'Be careful', 'Was this skills match accurate', 'Help us match better', 'We match your skills and credentials', 'Hide all'];
  let skipAllAfterBankWarning = false;
  const filteredDesc = descLines.filter(line => {
    const lower = line.toLowerCase();
    if (lower.includes('don\'t provide your bank') || lower.includes('credit card details') || lower.includes('learn how to protect yourself')) {
      skipAllAfterBankWarning = true;
      return false;
    }
    if (skipAllAfterBankWarning) return false;
    return !skipPhrases.some(phrase => lower.includes(phrase.toLowerCase())) && line.length > 5;
  });
  jobDesc = filteredDesc.join('\n\n');
  return { role: role.replace(/\s+/g, ' ').trim(), company: company.replace(/\s+/g, ' ').trim(), jobDescription: jobDesc.trim() };
}

export function buildFolderPath(jobsPath, jobDir) {
  return (jobsPath || '') + '/' + jobDir;
}