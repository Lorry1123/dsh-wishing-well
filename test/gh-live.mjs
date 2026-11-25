// Read-only live check of fetchPrs against real PRs through the user's gh.
// Usage: node test/gh-live.mjs <pr-url> [...]
import { fetchPrs, prStateOf } from '../github.js'

const urls = process.argv.slice(2)
const answers = await fetchPrs(urls, { distro: 'Ubuntu-22.04' })
for (const answer of answers) {
  const { greptile, checks, ...rest } = answer
  console.log(JSON.stringify({ ...rest, checkCount: checks?.length, greptileChars: greptile?.length ?? 0 }))
  console.log('  ->', JSON.stringify(prStateOf(answer)))
}
console.log(`answers: ${answers.length}/${urls.length}`)
