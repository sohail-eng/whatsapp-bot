import * as fs from 'fs';
import * as path from 'path';

const BLOCKED_PATTERNS_FILE = path.join(process.cwd(), 'blocked_patterns.txt');

let blockedPatterns: string[] = [];

// Load blocked patterns from file
function loadBlockedPatterns(): string[] {
  try {
    const content = fs.readFileSync(BLOCKED_PATTERNS_FILE, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')); // Filter out empty lines and comments
  } catch (error) {
    console.error('Error reading blocked_patterns.txt:', error);
    return [];
  }
}

// Initialize blocked patterns on module load
blockedPatterns = loadBlockedPatterns();

// Check if a message should be blocked based on patterns
export function isBlocked(messageFrom: string): boolean {
  return blockedPatterns.some(pattern => messageFrom.includes(pattern));
}

export function addBlockedPattern(pattern: string): void {
  blockedPatterns.push(pattern);
  fs.writeFileSync(BLOCKED_PATTERNS_FILE, blockedPatterns.join('\n'));
}

export function removeBlockedPattern(pattern: string): void {
  blockedPatterns = blockedPatterns.filter(p => !pattern.includes(p));
  fs.writeFileSync(BLOCKED_PATTERNS_FILE, blockedPatterns.join('\n'));
}

// Reload blocked patterns (useful if you want to update without restarting)
export function reloadBlockedPatterns(): void {
  blockedPatterns = loadBlockedPatterns();
  console.log(`Loaded ${blockedPatterns.length} blocked patterns`);
}

