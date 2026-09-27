import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const file = path.join(directory, name);
    return statSync(file).isDirectory() ? sourceFiles(file) : /\.tsx$/.test(name) ? [file] : [];
  });
}

describe('user-facing product copy', () => {
  it('avoids decorative emoji, em dashes, placeholders, and unsupported automation claims', () => {
    const files = [...sourceFiles(path.resolve('app')), ...sourceFiles(path.resolve('components'))];
    const forbidden = /—|[✅❌⚠️📥🔒🔌📊🔄🧹🔑💡📱📧📋🏦💳🧾📅📸📤🎉🚨⚡🎯💰]|coming soon|effortless tax|AI-powered|256-bit encryption|no manual data entry required|AI automatically categorizes/i;
    const failures = files.flatMap(file => {
      const match = readFileSync(file, 'utf8').match(forbidden);
      return match ? [`${path.relative(process.cwd(), file)}: ${match[0]}`] : [];
    });
    expect(failures).toEqual([]);
  });
});
