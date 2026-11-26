#!/usr/bin/env node
/**
 * Ask Puck to review a pull request and post the review as a PR comment.
 *
 * Runs from .github/workflows/agent-review.yml on every opened or updated pull
 * request. Reads the diff from git, sends it to the Puck Norris Superagent over
 * the Base44 agent API, and posts the reply back on the pull request.
 *
 * Environment
 *   PUCK_API_KEY        required, repo secret. Without it the step warns and
 *                       exits 0, so a missing key never blocks a pull request.
 *   PUCK_BASE           optional, agent API base.
 *   GITHUB_TOKEN        provided by Actions.
 *   GITHUB_REPOSITORY   provided by Actions, "owner/repo".
 *   PR_NUMBER           provided by the workflow.
 *   BASE_REF            provided by the workflow, the PR's base branch.
 *
 * Exit codes: 0 reviewed, skipped, or warned. 1 the review could not be delivered.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.PUCK_BASE ?? 'https://app.base44.com/api/agents/6a46ab1aa106551142301059';
const KEY = process.env.PUCK_API_KEY ?? '';
const GH = process.env.GITHUB_TOKEN ?? '';
const REPO = process.env.GITHUB_REPOSITORY ?? '';
const PR = process.env.PR_NUMBER ?? '';
const BASE_REF = process.env.BASE_REF ?? 'main';
const MAX_DIFF = 120_000;

const prompt = (diff) => `You are the change controller reviewing pull request #${PR} on ${REPO} (${BASE_REF}...HEAD). Read the diff itself, not a description of it. Report only what you can point at in the diff, in this order, highest severity first:

1. Secrets, tokens, keys or .env values committed into the tree.
2. Multi-tenancy leaks. This platform serves several promoter workspaces: flag any query, controller or guard that can reach another organisation's rows, any check that trusts a client-supplied orgId, and any new query that skips org scoping.
3. Auth regressions: a route that loses its guard, a check that trusts a client-supplied id, weakened session or MFA logic.
4. Prisma schema or migration changes with no stated rollback, and anything destructive to existing rows.
5. Tests deleted, weakened, or asserting nothing, and any \`as any\`, \`@ts-ignore\` or eslint-disable used to get the change through typecheck.
6. Email: this repo bans in-platform email systems (\`npm run check:no-email\`). Flag any new provider, module or endpoint.
7. Behaviour changed with no test that would catch a regression.
8. A branch that does two unrelated things.

Then give a verdict on its own line: SAFE TO MERGE, MERGE AFTER FIXES (list them), or DO NOT MERGE (say why). Cite file paths. If the change is documentation or CI only, say so in one line and stop.

Diff:

\`\`\`diff
${diff}
\`\`\`
`;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

async function agentApi(method, path, body) {
  const res = await fetch(`${BASE.replace(/\/$/, '')}${path}`, {
    method,
    headers: { api_key: KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`agent API ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const replyText = (resp) => {
  for (const key of ['content', 'message', 'text', 'response']) {
    const value = resp?.[key];
    if (typeof value === 'string') return value;
    if (value && typeof value.content === 'string') return value.content;
  }
  return JSON.stringify(resp, null, 2).slice(0, 4000);
};

async function conversationId() {
  const listing = await agentApi('GET', '/conversations');
  const items = listing.items ?? listing.conversations ?? listing;
  if (Array.isArray(items) && items.length > 0) return String(items[0].id);
  const created = await agentApi('POST', '/conversations', { title: 'PR reviews' });
  return String(created.id);
}

async function main() {
  if (!KEY) {
    console.log('::warning::PUCK_API_KEY is not set, skipping the agent review.');
    return 0;
  }
  if (!GH || !REPO || !PR) {
    console.log('::error::missing GITHUB_TOKEN, GITHUB_REPOSITORY or PR_NUMBER');
    return 1;
  }

  let diff;
  try {
    diff = git('diff', `origin/${BASE_REF}...HEAD`);
  } catch (error) {
    console.log(`::error::could not read the diff: ${error.message}`);
    return 1;
  }
  if (!diff.trim()) {
    console.log('empty diff, nothing to review');
    return 0;
  }
  if (diff.length > MAX_DIFF) {
    diff = `${diff.slice(0, MAX_DIFF)}\n... diff truncated at 120k characters ...`;
    console.log('::warning::diff truncated before review');
  }

  let review;
  try {
    const id = await conversationId();
    review = replyText(await agentApi('POST', `/conversations/${id}/messages`, { content: prompt(diff) }));
  } catch (error) {
    console.log(`::error::agent review failed: ${error.message}`);
    return 1;
  }

  const body = `## Puck review\n\n${review}\n\n---\n*Automated review by the Puck Norris Superagent. It reads the diff; it does not replace your judgement.*`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${PR}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${GH}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    console.log(`::error::could not post the review comment: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return 1;
  }
  console.log(`review posted on ${REPO}#${PR}`);
  return 0;
}

process.exit(await main());
