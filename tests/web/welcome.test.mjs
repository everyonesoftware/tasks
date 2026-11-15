import test from 'node:test';
import assert from 'node:assert/strict';
const welcome=await import('../../apps/web/welcome.mjs').catch(()=>({}));

test('all-in-one setup is a single accessible account form with expandable operator help',()=>{
  assert.equal(typeof welcome.welcomeMarkup,'function');
  const html=welcome.welcomeMarkup('setup');
  assert.equal((html.match(/<form\b/g)||[]).length,1);
  assert.match(html,/<form id="setup-form"/);
  for (const id of ['setup-key','username','password']) assert.match(html,new RegExp(`<label for="${id}">`));
  assert.match(html,/<input id="setup-key"[^>]*name="setupKey"[^>]*required/);
  assert.match(html,/<input id="username"[^>]*autocomplete="username"/);
  assert.match(html,/<input id="password"[^>]*type="password"[^>]*autocomplete="new-password"[^>]*minlength="8"/);
  assert.match(html,/id="setup-error"[^>]*role="alert"/);
  assert.match(html,/<button type="submit"[^>]*>Create account &amp; start<\/button>/);
  assert.match(html,/<details[\s\S]*<summary>Where do I get a setup key\?<\/summary>/);
  assert.match(html,/tasks setup-key/);assert.match(html,/30 minutes/);
  assert.doesNotMatch(html,/server-origin|readonly|example|calibration|localStorage|sessionStorage|value="[^"\s]+"/i);
});
test('welcome checking and detection errors expose no account form or task shell',()=>{
  const checking=welcome.welcomeMarkup('checking');
  assert.match(checking,/Checking this server/);assert.match(checking,/role="status"/);
  assert.doesNotMatch(checking,/<form|setup-key|username|task-dialog/);
  const failed=welcome.welcomeMarkup('error','Server <unavailable>');
  assert.match(failed,/couldn’t check this server/);assert.match(failed,/Server &lt;unavailable&gt;/);
  assert.match(failed,/id="retry"/);assert.doesNotMatch(failed,/<form/);
});
test('returning welcome shows sign in, not an open registration or server editor',()=>{
  const html=welcome.welcomeMarkup('signin','','https://tasks.example');
  assert.match(html,/<form id="auth-form"/);assert.match(html,/autocomplete="current-password"/);
  assert.match(html,/Need an account\?/);assert.match(html,/Public sign-up is not available/);
  assert.doesNotMatch(html,/setup-key|new-password|create account/i);
  assert.match(html,/<label for="server-origin">Current server<\/label>/);
  assert.match(html,/<input id="server-origin"[^>]*readonly[^>]*value="https:\/\/tasks.example"/);
  assert.match(welcome.welcomeMarkup('signin','','https://tasks.example/"<test>'),/value="https:\/\/tasks.example\/&quot;&lt;test&gt;"/);
});
