import { spawnSync } from 'node:child_process'

const argument = process.argv[2]
const remote = argument || spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim()
const normalized = remote?.replace(/^git@(github\.com|gitlab\.com):/, 'https://').replace(/\.git$/, '')
let url
try {
  url = new URL(normalized)
  if (!['github.com', 'gitlab.com'].includes(url.hostname) || url.protocol !== 'https:' ||
    url.username || url.password || url.pathname.split('/').filter(Boolean).length < 2) throw new Error()
} catch {
  console.error('Provide a public GitHub/GitLab repository URL: pnpm deploy:button https://github.com/owner/app-gallery')
  process.exit(1)
}
url.search = ''
url.hash = ''
const deployUrl = `https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(url.toString())}`
console.log(`[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](${deployUrl})`)
