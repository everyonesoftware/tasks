import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/publish.yml', root), 'utf8');
const job = name => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';
const step = (body, id) => body.split(/^      - /m).find(block => block.includes(`\n        id: ${id}\n`)) ?? '';
const pin = '[a-f0-9]{40}';

test('capture preserves the actual published digest, tags, and version without failing the container job', () => {
  const container = job('container');
  const push = step(container, 'services_push');
  const capture = step(container, 'services_capture');
  assert.match(capture, new RegExp(`uses: everyonesoftware/workflows-common/actions/capture-image-v1@${pin}(?: |\\n)`));
  assert.ok(container.includes('services_artifact: ${{ steps.services_capture.outputs.artifact }}'));
  assert.ok(push.includes('push: true'));
  assert.ok(push.includes('tags: ${{ steps.tags.outputs.tags }}'));
  assert.ok(push.includes('VERSION=${{ needs.validate.outputs.version }}'));
  assert.ok(container.includes('bash scripts/container-tags.sh "$DAYMARK_VERSION" "$GITHUB_SHA"'));
  assert.ok(container.indexOf(push) < container.indexOf(capture));
  assert.doesNotMatch(capture, /\n        if:|\n        env:|\n        run:/);
  assert.ok(capture.includes('continue-on-error: true'));
  assert.ok(capture.includes('with:\n          digest: ${{ steps.services_push.outputs.digest }}\n          tags: ${{ steps.tags.outputs.tags }}\n          version: ${{ needs.validate.outputs.version }}'));
  assert.doesNotMatch(container, /actions\/upload-artifact|scripts\/publish-notification\.mjs/);
});

test('only a successful main container publication with an artifact can call the pinned notifier', () => {
  const notify = job('services_notify');
  const sha = step(job('container'), 'services_capture').match(new RegExp(`capture-image-v1@(${pin})`))?.[1];
  assert.ok(sha, 'capture has a full SHA pin');
  assert.ok(notify.includes(`\n    uses: everyonesoftware/workflows-common/.github/workflows/notify-image-v1.yml@${sha}\n`));
  assert.ok(notify.includes('    needs: container\n'));
  assert.ok(notify.includes("    if: ${{ !cancelled() && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' && needs.container.result == 'success' && needs.container.outputs.services_artifact != '' && vars.SERVICES_PUBLISH_NOTIFICATIONS == 'true' }}\n"));
  assert.ok(notify.includes('    permissions:\n      contents: read\n      id-token: write\n'));
  assert.ok(notify.includes(`    with:
      artifact: \${{ needs.container.outputs.services_artifact }}
      services-url: \${{ vars.SERVICES_PUBLISH_URL }}
      tailscale-client-id: \${{ vars.TAILSCALE_CLIENT_ID }}
      tailscale-audience: \${{ vars.TAILSCALE_AUDIENCE }}
      tailscale-tags: \${{ vars.TAILSCALE_TAGS }}
    secrets:
      services-token: \${{ secrets.SERVICES_PUBLISH_TOKEN }}`));
  assert.doesNotMatch(notify, /runs-on:|steps:|secrets: inherit|packages:|contents: write/);
});

test('connection test stays manual and separate from publication; retired sender is unused', () => {
  assert.match(workflow, /^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n\n/m);
  assert.ok(job('validate').includes('node --test tests/deployment/services_notification_workflow.test.mjs'));
  const connection = readFileSync(new URL('.github/workflows/services-connection-test.yml', root), 'utf8');
  assert.match(connection, /^on:\n  workflow_dispatch:/m);
  assert.ok(connection.includes('node scripts/publisher-connection-test.mjs'));
  assert.ok(existsSync(new URL('scripts/publisher-connection-test.mjs', root)));
  assert.ok(!existsSync(new URL('scripts/publish-notification.mjs', root)));
});
