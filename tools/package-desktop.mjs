// Demo builds are local, explicitly unsigned/ad-hoc, and never auto-published.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const target = process.argv[2];
if (!['mac', 'win', 'all'].includes(target)) throw new Error('Usage: node tools/package-desktop.mjs mac|win|all');
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(CSC_|WIN_CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|KEYCHAIN_)/.test(name)) delete env[name];
}
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const platforms = target === 'all' ? ['--mac', '--win'] : [`--${target}`];
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...platforms, '--publish', 'never'], {
  stdio: 'inherit', env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
