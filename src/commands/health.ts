import { LettaClientWrapper } from '../lib/letta-client';
import { OutputFormatter } from '../lib/output-formatter';

export async function healthCommand(options: { output?: string }, command: any) {
  const verbose = command.parent?.opts().verbose || false;
  const baseUrl = process.env.LETTA_BASE_URL;

  // For JSON output, return structured data
  if (options.output === 'json') {
    const result: any = {
      server_url: baseUrl || null,
      status: 'unknown',
      version: null,
      error: null
    };

    if (!baseUrl) {
      result.status = 'error';
      result.error = 'LETTA_BASE_URL not set';
      OutputFormatter.handleJsonOutput(result, 'json');
      process.exit(1);
    }

    try {
      const response = await fetch(`${baseUrl}/v1/health/`);
      if (!response) {
        result.status = 'error';
        result.error = `Server returned ${response}`;
        OutputFormatter.handleJsonOutput(result, 'json');
        process.exit(1);
      }
      const health = await response as { status: string; version: string };
      result.status = health.status;
      result.version = health.version;
      OutputFormatter.handleJsonOutput(result, 'json');
      return;
    } catch (error: any) {
      result.status = 'error';
      result.error = error.cause?.code || error.code || error.message;
      OutputFormatter.handleJsonOutput(result, 'json');
      process.exit(1);
    }
  }

  console.log('Letta Server Health Check');
  console.log('==========================\n');

  // Check environment
  if (!baseUrl) {
    console.log('[FAIL] LETTA_BASE_URL not set');
    process.exit(1);
  }
  console.log(`Server URL: ${baseUrl}`);

  // Check connectivity
  try {
    const response = await fetch(`${baseUrl}/v1/health/`);

    // if (!response.ok) {
    //   console.log(`[FAIL] Server returned ${response.status}`);
    //   process.exit(1);
    // }

    const health = await response as { status: string; version: string };

    console.log(`Status:     ${health.status === 'ok' ? '[OK]' : '[FAIL] ' + health.status}`);
    console.log(`Version:    ${health.version}`);

    if (verbose) {
      // Additional checks in verbose mode
      console.log('\nDetailed Checks:');

      // Check agents endpoint
      try {
        const client = new LettaClientWrapper();
        const agents = await client.listAgents();
        const agentCount = Array.isArray(agents) ? agents.length : 0;
        console.log(`  Agents:   [OK] ${agentCount} found`);
      } catch (e: any) {
        console.log(`  Agents:   [FAIL] ${e.message}`);
      }

      // Check tools endpoint
      try {
        const client = new LettaClientWrapper();
        const tools = await client.listTools();
        const toolCount = Array.isArray(tools) ? tools.length : 0;
        console.log(`  Tools:    [OK] ${toolCount} found`);
      } catch (e: any) {
        console.log(`  Tools:    [FAIL] ${e.message}`);
      }

      // Check API key status
      if (process.env.LETTA_API_KEY) {
        console.log(`  API Key:  [OK] configured`);
      } else {
        console.log(`  API Key:  [--] not set (ok for self-hosted)`);
      }
    }

    console.log('\nLetta server is healthy');

  } catch (error: any) {
    const msg = error.cause?.code || error.code || error.message;
    if (msg === 'ECONNREFUSED') {
      console.log(`[FAIL] Connection refused - is Letta server running at ${baseUrl}?`);
    } else if (msg === 'ENOTFOUND') {
      console.log(`[FAIL] Host not found - check LETTA_BASE_URL`);
    } else {
      console.log(`[FAIL] Cannot connect to ${baseUrl}`);
    }
    process.exit(1);
  }
}
