import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTools } from './src/tools.ts';
import { envSchema } from './src/types.ts';
import { buildMcpServer, ctxFromCreds } from './src/remote/agent.ts';
import { getCredentials, putCredentials } from './src/remote/storage.ts';
import {
  handleSetup,
  renderLanding,
  renderSetupPage,
  renderSetupSuccess,
} from './src/remote/setup.ts';

const dates = { startDate: '2026-10-01', endDate: '2026-10-08' };
const ctx = {
  tempoApi: { baseUrl: 'https://api.tempo.io/4', token: 'test-tempo-token' },
};
const removedTools = [
  'createWorklog',
  'bulkCreateWorklogs',
  'editWorklog',
  'deleteWorklog',
  'getMissingWorklogDays',
  'getWorklogAnalytics',
];

function worklog(id = 1, author = 'first-account') {
  return {
    tempoWorklogId: id,
    issue: {
      id: '10001',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
    },
    author: {
      accountId: author,
      self: 'https://example.atlassian.net/rest/api/3/user',
    },
    timeSpentSeconds: 7200,
    startDate: '2026-10-08',
    description: 'Investigation',
  };
}

function mockTempo(t, respond) {
  const requests = [];
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    assert.equal(config.baseURL, ctx.tempoApi.baseUrl);
    assert.equal(config.url, '/worklogs');
    assert.equal(config.method, 'get');
    assert.equal(
      config.headers.get('Authorization'),
      `Bearer ${ctx.tempoApi.token}`,
    );
    assert.equal(config.params.from, dates.startDate);
    assert.equal(config.params.to, dates.endDate);
    return {
      data: await respond(config, requests.length),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  t.after(() => {
    axios.defaults.adapter = original;
  });
  return requests;
}

test('retrieval returns all authors and raw IDs, without following embedded URLs', async (t) => {
  const first = {
    ...worklog(),
    issue: {
      id: 10001,
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
    },
    startTime: '09:00:00',
    attributes: { values: [{ key: '_Account_', value: 'account-key' }] },
  };
  const second = {
    ...worklog(2, 'second-account'),
    issue: { id: '001002' },
    description: '',
  };
  const third = { ...worklog(3), issue: undefined, author: undefined };
  const requests = mockTempo(t, () => ({ results: [first, second, third] }));
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 3);
  assert.match(
    result.content[0].text,
    /IssueId: 10001 \| AuthorAccountId: first-account/,
  );
  assert.match(result.content[0].text, /StartTime: 09:00:00/);
  assert.match(
    result.content[0].text,
    /Hours: 2.00 \| Description: Investigation/,
  );
  assert.match(
    result.content[0].text,
    /Attributes: \[{"key":"_Account_","value":"account-key"}\]/,
  );
  assert.match(
    result.content[1].text,
    /IssueId: 001002 \| AuthorAccountId: second-account/,
  );
  assert.match(result.content[1].text, /Description: $/);
  assert.match(result.content[2].text, /IssueId: Missing/);
  assert.doesNotMatch(result.content[2].text, /AuthorAccountId:/);
  assert.doesNotMatch(JSON.stringify(result.content), /IssueKey|atlassian/);
  assert.deepEqual(result.metadata, {
    totalCount: 3,
    pagesProcessed: 1,
    ...dates,
  });
  assert.equal(requests.length, 1);
});

test('pagination uses applied offsets and limits without requesting continuation URLs', async (t) => {
  const requests = mockTempo(t, (config, page) => ({
    results: [worklog(page)],
    metadata: {
      offset: config.params.offset,
      limit: 1,
      ...(page < 3 && {
        next: 'https://example.atlassian.net/rest/api/3/myself',
      }),
    },
  }));
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(
    requests.map((r) => r.params.offset),
    [0, 1, 2],
  );
  assert.ok(requests.every((r) => r.params.limit === 1000));
  assert.equal(result.metadata.totalCount, 3);
  assert.equal(result.metadata.pagesProcessed, 3);
});

test('empty results preserve the empty message and terminate after one request', async (t) => {
  const requests = mockTempo(t, () => ({
    results: [],
    metadata: { count: 0 },
  }));
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, undefined);
  assert.equal(
    result.content[0].text,
    'No worklogs found for the specified date range.',
  );
  assert.equal(result.metadata.totalCount, 0);
  assert.equal(requests.length, 1);
});

test('non-progressing pagination and invalid applied limits fail without returning partial data', async (t) => {
  for (const page of [
    { results: [], metadata: { next: 'ignored' } },
    { results: [worklog()], metadata: { next: 'ignored', limit: 0 } },
    { results: [worklog()], metadata: { next: 'ignored', limit: -1 } },
    { results: [worklog()], metadata: { next: 'ignored', limit: 1.5 } },
    { results: [worklog()], metadata: { next: 'ignored', offset: -1 } },
  ]) {
    await t.test(JSON.stringify(page.metadata), async (t) => {
      const requests = mockTempo(t, () => page);
      const result = await createTools(ctx).retrieveWorklogs(
        dates.startDate,
        dates.endDate,
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /pagination did not advance/);
      assert.equal(result.metadata, undefined);
      assert.equal(requests.length, 1);
    });
  }
});

test('repeated server offsets fail on the next page', async (t) => {
  const requests = mockTempo(t, () => ({
    results: [worklog()],
    metadata: { next: 'ignored', offset: 0, limit: 1 },
  }));
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /pagination did not advance/);
  assert.equal(requests.length, 2);
});

test('the page cap fails instead of returning incomplete results', async (t) => {
  const requests = mockTempo(t, (config) => ({
    results: [worklog()],
    metadata: { next: 'ignored', offset: config.params.offset, limit: 1 },
  }));
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /maximum page limit \(500\)/);
  assert.equal(result.metadata, undefined);
  assert.equal(requests.length, 500);
});

test('Tempo permission failures preserve error messages and isError', async (t) => {
  mockTempo(t, (config) => {
    throw new AxiosError(
      'Request failed with status code 403',
      'ERR_BAD_REQUEST',
      config,
      undefined,
      {
        data: { errors: [{ message: 'Not permitted to view worklogs' }] },
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config,
      },
    );
  });
  const result = await createTools(ctx).retrieveWorklogs(
    dates.startDate,
    dates.endDate,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Not permitted to view worklogs/);
});

test('invalid and reversed dates are rejected before making a request', async (t) => {
  const requests = mockTempo(t, () => assert.fail('No request expected'));
  for (const [start, end] of [
    ['2026-10-09', dates.endDate],
    ['2026-02-30', dates.endDate],
    ['2026-13-01', dates.endDate],
    ['10/01/2026', dates.endDate],
    [dates.startDate, 'invalid'],
  ]) {
    const result = await createTools(ctx).retrieveWorklogs(start, end);
    assert.equal(result.isError, true);
  }
  assert.equal(requests.length, 0);
});

async function checkToolSurface(client) {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['retrieveWorklogs'],
  );
  assert.deepEqual(Object.keys(tools[0].inputSchema.properties).sort(), [
    'endDate',
    'startDate',
  ]);
  assert.deepEqual(tools[0].inputSchema.required.sort(), [
    'endDate',
    'startDate',
  ]);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  for (const name of removedTools) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  }
  const result = await client.callTool({
    name: 'retrieveWorklogs',
    arguments: dates,
  });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /IssueId: 10001/);
  return tools[0];
}

test('remote MCP advertises only retrieval and forwards Tempo failures', async (t) => {
  let fail = false;
  mockTempo(t, (config) => {
    if (fail) {
      throw new AxiosError('Tempo unavailable', 'ERR_BAD_RESPONSE', config);
    }
    return { results: [worklog()] };
  });
  const server = buildMcpServer({ tempoApiToken: ctx.tempoApi.token });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tool = await checkToolSurface(client);
  assert.match(tool.description, /visible to TEMPO_API_TOKEN/);
  fail = true;
  const result = await client.callTool({
    name: 'retrieveWorklogs',
    arguments: dates,
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Tempo unavailable/);
});

test('stdio starts with only a Tempo token and ignores obsolete OAuth configuration', async (t) => {
  for (const obsoleteEnv of [
    {},
    {
      JIRA_AUTH_TYPE: 'oauth',
      JIRA_API_TOKEN: 'ignored',
      JIRA_BASE_URL: 'invalid',
    },
  ]) {
    await t.test(
      Object.keys(obsoleteEnv).length ? 'obsolete configuration' : 'Tempo only',
      async (t) => {
        const bootstrap = `
        import assert from 'node:assert/strict';
        import axios from 'axios';
        axios.defaults.adapter = async (config) => {
          assert.equal(config.baseURL, 'https://api.tempo.io/4');
          assert.equal(config.url, '/worklogs');
          assert.equal(config.method, 'get');
          assert.equal(config.headers.get('Authorization'), 'Bearer test-tempo-token');
          return { data: { results: [${JSON.stringify(worklog())}] }, status: 200, statusText: 'OK', headers: {}, config };
        };
        await import('./src/index.ts');
      `;
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: ['--import', 'tsx', '--input-type=module', '--eval', bootstrap],
          cwd: import.meta.dirname,
          env: {
            ...getDefaultEnvironment(),
            TEMPO_API_TOKEN: ctx.tempoApi.token,
            ...obsoleteEnv,
          },
          stderr: 'pipe',
        });
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        t.after(() => client.close());
        await client.connect(transport);
        await checkToolSurface(client);
      },
    );
  }
});

test('environment validation requires only a nonempty Tempo token', () => {
  assert.deepEqual(
    envSchema.parse({ TEMPO_API_TOKEN: 'token', JIRA_AUTH_TYPE: 'invalid' }),
    { TEMPO_API_TOKEN: 'token' },
  );
  assert.equal(envSchema.safeParse({}).success, false);
  assert.equal(envSchema.safeParse({ TEMPO_API_TOKEN: '  ' }).success, false);
});

function storageEnv() {
  const records = new Map();
  const writes = [];
  return {
    records,
    writes,
    ENCRYPTION_KEY: 'test-encryption-key-that-is-at-least-32-bytes',
    USERS: {
      get: async (key) => records.get(key) ?? null,
      put: async (key, value) => {
        records.set(key, value);
        writes.push(key);
      },
    },
  };
}

async function decryptRecord(env, blob) {
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(env.ENCRYPTION_KEY),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const bytes = Buffer.from(blob, 'base64');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
    key,
    bytes.subarray(12),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

test('new encrypted records persist only the Tempo token, even when passed extra fields', async () => {
  const env = storageEnv();
  await putCredentials(env, 'u_test', {
    tempoApiToken: 'token',
    jiraApiToken: 'obsolete',
  });
  assert.deepEqual(await decryptRecord(env, env.records.get('user:u_test')), {
    tempoApiToken: 'token',
  });
  assert.deepEqual(await getCredentials(env, 'u_test'), {
    tempoApiToken: 'token',
  });
});

test('legacy encrypted records retain their IDs and yield a Tempo-only context without writes', async () => {
  const env = storageEnv();
  const legacyBlob =
    'AAECAwQFBgcICQoLapELD0cyep5CMvjKX6hLJVrBgZLJPeu1h2t2rbAQgWU9Zi1yabnZP0X1IkGkDze0ugDQa3tJ5pFvTtC1O/Il5GW1IPZzN5OAk513RLf1TG32toGnYtGtjPsNGsm4/duDkwEmMScNSnx8+d7XWGOt1gOEyrNwhc5rVS0Mmszr8vO++/Whcj4waauJvdRD6O6+Dpa2e3Biw1CsXDGgKAxHn+pMOtB3rRrCZqGY6V4BH1BHwFtfykTIQr8ONK7OLDY5e3Ff6QuCmvpMKfspE8ncH7rT7cg4qe1+87G8nCWInuJCd9tL01s=';
  const id = 'u_abcdefghijklmnopqrstuv';
  env.records.set(`user:${id}`, legacyBlob);
  const creds = await getCredentials(env, id);
  assert.deepEqual(creds, { tempoApiToken: 'legacy-tempo-token' });
  assert.deepEqual(ctxFromCreds(creds), {
    tempoApi: { baseUrl: ctx.tempoApi.baseUrl, token: 'legacy-tempo-token' },
  });
  assert.deepEqual(env.writes, []);
  assert.equal(env.records.get(`user:${id}`), legacyBlob);
  assert.equal(await getCredentials(env, 'u_missing'), null);
});

test('setup validates only the Tempo token and writes a usable connector record', async () => {
  const env = storageEnv();
  const form = new FormData();
  form.set('tempoApiToken', ' token ');
  form.set('jiraApiToken', 'ignored');
  const response = await handleSetup(
    new Request('https://example.test/setup', { method: 'POST', body: form }),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  const id = body.match(/https:\/\/example.test\/mcp\/(u_[\w-]+)/)[1];
  assert.deepEqual(await getCredentials(env, id), { tempoApiToken: 'token' });
  assert.deepEqual(await decryptRecord(env, env.records.get(`user:${id}`)), {
    tempoApiToken: 'token',
  });

  const missing = await handleSetup(
    new Request('https://example.test/setup', {
      method: 'POST',
      body: new FormData(),
    }),
    env,
  );
  assert.equal(missing.status, 400);
  assert.match(await missing.text(), /Tempo API token is required/);
  assert.equal(env.writes.length, 1);
});

test('onboarding HTML describes retrieval and contains no Jira credential inputs', () => {
  const pages = [
    renderLanding(),
    renderSetupPage(),
    renderSetupSuccess('https://example.test/mcp/u_test'),
  ];
  for (const page of pages) {
    assert.doesNotMatch(
      page,
      /jiraApiToken|jiraBaseUrl|jiraEmail|jiraAuthType|syncAuthType|read and write/,
    );
    for (const tool of removedTools) assert.ok(!page.includes(tool));
  }
  assert.match(pages[1], /name="tempoApiToken"/);
});
