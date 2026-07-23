import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    NO_COLOR: '1',
  },
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  throw new Error(`npm pack exited with code ${result.status}`);
}

const output = result.stdout.trim();
let manifests;
try {
  manifests = JSON.parse(output);
} catch {
  const jsonStart = output.lastIndexOf('\n[');
  if (jsonStart === -1) {
    process.stderr.write(result.stderr);
    throw new Error('npm pack did not return valid JSON');
  }
  manifests = JSON.parse(output.slice(jsonStart + 1));
}

if (!Array.isArray(manifests) || manifests.length !== 1) {
  throw new Error('npm pack must produce exactly one package');
}

const files = new Set(manifests[0].files.map(({ path }) => path));
const requiredFiles = [
  'LICENSE',
  'README.md',
  'esm/index.d.ts',
  'esm/index.js',
  'esm/renderer.d.ts',
  'esm/renderer.js',
  'package.json',
];
const missingFiles = requiredFiles.filter((path) => !files.has(path));

if (missingFiles.length > 0) {
  throw new Error(
    `npm package is missing required files: ${missingFiles.join(', ')}`,
  );
}

const unexpectedFiles = [...files].filter(
  (path) =>
    path !== 'LICENSE' &&
    path !== 'README.md' &&
    path !== 'package.json' &&
    !path.startsWith('esm/'),
);

if (unexpectedFiles.length > 0) {
  throw new Error(
    `npm package contains unexpected files: ${unexpectedFiles.join(', ')}`,
  );
}

console.log(
  `Package manifest verified: ${files.size} files, ${manifests[0].size} bytes`,
);
