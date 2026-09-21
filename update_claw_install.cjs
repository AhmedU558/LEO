const fs = require('fs');
const file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

const replacement = `
  const entry = commands[manager];
  if (!entry) return { success: false, error: \`Unsupported package manager: \${manager}\` };

  try {
    const mountSource = process.platform === 'win32'
      ? \`/\${wsPath.charAt(0).toLowerCase()}\${wsPath.slice(2).replace(/\\\\/g, '/')}\`
      : wsPath;

    const dockerImage = manager === 'pip' ? 'python:3.11-slim' : 'node:20-alpine';
    
    // Rewrite the command arguments to use the container's workspace mount path
    let containerArgs = [...entry.args];
    if (manager === 'npm') containerArgs = ['install', '--prefix', '/workspace', packageName];
    if (manager === 'pnpm') containerArgs = ['add', '--dir', '/workspace', packageName];
    if (manager === 'pip') containerArgs = ['install', '--target', '/workspace/pip_packages', packageName];

    const cmdArgs = [
      'run', '--rm', '--network', 'host',
      '--memory', '512m', '--cpus', '1',
      '--workdir', '/workspace',
      '-v', \`\${mountSource}:/workspace\`,
      dockerImage,
      entry.cmd,
      ...containerArgs
    ];

    const { stdout, stderr } = await execFileAsync('docker', cmdArgs, {
      timeout: 120_000,
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    });
`;

code = code.replace(/const entry = commands\[manager\];[\s\S]*?cwd: wsPath,[\s\S]*?}\);/m, replacement);
fs.writeFileSync(file, code, 'utf8');
