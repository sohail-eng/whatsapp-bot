import fs from 'fs';
import path from 'path';
const PROFILE_PROMPT_KEYS = [
  'identity.fullName',
  'contact.email',
  'social.github',
  'professional.title',
  'professional.experienceYears',
  'professional.currentFocus',
  'professional.previousTechnologies',
  'professional.frontend',
  'professional.backend',
  'professional.workStyle',
  'interests.hobbies',
  'identity.maritalStatus',
] as const;

const PROFILE_DATA_PATH = path.join(process.cwd(), 'profile_data.json');

export interface ProfileData {
  identity: {
    fullName: string;
    preferredName: string;
    birthday: string;
    age: string;
    maritalStatus: string;
    wifeName: string;
    sisterName: string;
    brotherName: string;
    fatherName: string;
    motherName: string;
  };
  contact: {
    email: string;
    phone: string;
    whatsapp: string;
  };
  social: {
    github: string;
    linkedin: string;
    website: string;
  };
  professional: {
    title: string;
    experienceYears: string;
    currentFocus: string;
    previousTechnologies: string[];
    frontend: string[];
    backend: string[];
    workStyle: string[];
  };
  interests: {
    hobbies: string[];
  };
  assistantRules: {
    allowedLanguages: string[];
    disallowedLanguages: string[];
    urgentMessage: string;
  };
}

let cachedProfileData: ProfileData | null = null;

function defaultProfileData(): ProfileData {
  return {
    identity: {
      fullName: 'Sohail Amjad',
      preferredName: 'Sohail',
      birthday: '',
      age: '',
      maritalStatus: '',
      wifeName: '',
      sisterName: '',
      brotherName: '',
      fatherName: '',
      motherName: '',
    },
    contact: {
      email: 'sohailamjad865@gmail.com',
      phone: '',
      whatsapp: '',
    },
    social: {
      github: 'sohail-eng',
      linkedin: '',
      website: '',
    },
    professional: {
      title: 'Software Engineer',
      experienceYears: 'almost 5 years',
      currentFocus: 'Python',
      previousTechnologies: ['C#', 'C++', 'Java'],
      frontend: ['React.js'],
      backend: ['Python'],
      workStyle: ['clean code', 'problem-solving', 'practical tech solutions'],
    },
    interests: {
      hobbies: ['building automation tools', 'backend systems', 'practical software solutions'],
    },
    assistantRules: {
      allowedLanguages: ['English', 'Urdu', 'Roman Urdu'],
      disallowedLanguages: ['Hindi'],
      urgentMessage: 'This seems urgent, you should call Sohail directly.',
    },
  };
}

export function getProfileData(): ProfileData {
  if (cachedProfileData) return cachedProfileData;

  try {
    if (!fs.existsSync(PROFILE_DATA_PATH)) {
      cachedProfileData = defaultProfileData();
      return cachedProfileData;
    }
    const raw = fs.readFileSync(PROFILE_DATA_PATH, 'utf-8');
    cachedProfileData = JSON.parse(raw) as ProfileData;
    return cachedProfileData;
  } catch (error) {
    console.error('[PROFILE DATA ERROR]', error);
    cachedProfileData = defaultProfileData();
    return cachedProfileData;
  }
}

function getNestedValue(source: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return '';
  }, source);
}

export function getProfileSchemaKeys(): string[] {
  const profile = getProfileData() as unknown as Record<string, unknown>;
  const result: string[] = [];

  const walk = (prefix: string, value: unknown) => {
    if (Array.isArray(value) || typeof value === 'string') {
      result.push(prefix);
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        walk(prefix ? `${prefix}.${key}` : key, child);
      });
    }
  };

  walk('', profile);
  return result.sort();
}

export function getProfileValueByKey(key: string): string | string[] | '' {
  const value = getNestedValue(getProfileData() as unknown as Record<string, unknown>, key);
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') return value;
  return '';
}

export function getProfileValues(keys: string[]): Record<string, string | string[] | ''> {
  return keys.reduce<Record<string, string | string[] | ''>>((acc, key) => {
    acc[key] = getProfileValueByKey(key);
    return acc;
  }, {});
}

export function hasProfileValue(key: string): boolean {
  const value = getProfileValueByKey(key);
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

function renderProfileKey(key: string, value: string | string[]): string {
  const printable = Array.isArray(value) ? value.join(', ') : value;
  return `- ${key}: ${printable || 'unknown'}`;
}

export function buildProfilePromptContext(keys: string[] = [...PROFILE_PROMPT_KEYS]): string {
  const values = getProfileValues(keys);
  return ['Sohail profile:', ...keys.map((key) => renderProfileKey(key, values[key]))].join('\n');
}
