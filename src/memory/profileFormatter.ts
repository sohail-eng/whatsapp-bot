import { AnswerStyle, DetectedLanguage } from './types';
import { getProfileValues, hasProfileValue } from '../profileData';

function unknownResponse(language: DetectedLanguage): string {
  if (language === 'roman_urdu') return 'Mere paas Sohail ke is detail ke bare mein maloomat nahi hai.';
  if (language === 'urdu') return 'میرے پاس سہیل کے اس معاملے کے بارے میں معلومات نہیں ہیں۔';
  return "I don't have that information about Sohail.";
}

function factLabel(key: string, language: DetectedLanguage): string {
  const map: Record<string, { english: string; roman_urdu: string; urdu: string }> = {
    'identity.wifeName': { english: "Sohail's wife's name", roman_urdu: 'Sohail ki wife ka naam', urdu: 'سہیل کی اہلیہ کا نام' },
    'identity.sisterName': { english: "Sohail's sister's name", roman_urdu: 'Sohail ki sister ka naam', urdu: 'سہیل کی بہن کا نام' },
    'identity.maritalStatus': { english: 'Sohail', roman_urdu: 'Sohail', urdu: 'سہیل' },
    'identity.birthday': { english: "Sohail's birthday", roman_urdu: 'Sohail ki birthday', urdu: 'سہیل کی سالگرہ' },
    'contact.email': { english: "Sohail's email", roman_urdu: 'Sohail ka email', urdu: 'سہیل کا ای میل' },
    'social.github': { english: "Sohail's GitHub username", roman_urdu: 'Sohail ka GitHub username', urdu: 'سہیل کا GitHub username' },
    'professional.experienceYears': { english: 'Sohail has', roman_urdu: 'Sohail ko', urdu: 'سہیل کے پاس' },
  };
  return map[key]?.[language] || key;
}

function formatSingleFact(key: string, value: string | string[], language: DetectedLanguage): string {
  const printable = Array.isArray(value) ? value.join(', ') : value;
  if (key === 'identity.maritalStatus') {
    if (language === 'english') return `Sohail is ${printable.toLowerCase()}.`;
    if (language === 'urdu') return `سہیل ${printable === 'Married' ? 'شادی شدہ' : printable} ہیں۔`;
    return `Sohail ${printable === 'Married' ? 'shadi shuda' : printable} hain.`;
  }
  if (key === 'professional.experienceYears') {
    if (language === 'english') return `Sohail has ${printable} of software engineering experience.`;
    if (language === 'urdu') return `سہیل کے پاس software engineering کا ${printable} کا تجربہ ہے۔`;
    return `Sohail ko software engineering ka ${printable} ka experience hai.`;
  }
  if (language === 'english') return `${factLabel(key, language)} is ${printable}.`;
  if (language === 'urdu') return `${factLabel(key, language)} ${printable} ہے۔`;
  return `${factLabel(key, language)} ${printable} hai.`;
}

export function buildProfileReplyFromKeys(
  requiredKeys: string[],
  language: DetectedLanguage,
  answerStyle: AnswerStyle,
): string {
  if (requiredKeys.length === 0) return unknownResponse(language);

  const firstMissing = requiredKeys.find((key) => !hasProfileValue(key));
  if (firstMissing) return unknownResponse(language);

  const values = getProfileValues(requiredKeys);

  if (answerStyle === 'single_fact' && requiredKeys.length === 1) {
    return formatSingleFact(requiredKeys[0], values[requiredKeys[0]], language);
  }

  const rendered = requiredKeys.map((key) => {
    const value = values[key];
    const printable = Array.isArray(value) ? value.join(', ') : value;
    return `${factLabel(key, language)}: ${printable}`;
  });

  if (answerStyle === 'list') {
    return rendered.join(language === 'english' ? '\n' : '\n');
  }

  if (language === 'english') {
    return `Here is what I know about Sohail: ${rendered.join('; ')}.`;
  }
  if (language === 'urdu') {
    return `سہیل کے بارے میں میرے پاس یہ معلومات ہیں: ${rendered.join('؛ ')}۔`;
  }
  return `Sohail ke bary mein mere paas yeh maloomat hai: ${rendered.join('; ')}.`;
}
