const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  function getLatestCode() {
    const logPath = '/Users/costalong/code/go/src/github.com/costa92/llm-agent-ecosystem/llm-agent-studio/logs/studiod.log';
    if (!fs.existsSync(logPath)) {
      console.log('Log file does not exist');
      return null;
    }
    const logs = fs.readFileSync(logPath, 'utf8');
    const lines = logs.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes('email=pfadmin@s.com') && line.includes('code=')) {
        const match = line.match(/code=(\d{6})/);
        if (match) {
          return match[1];
        }
      }
    }
    return null;
  }

  try {
    console.log('Navigating to login page...');
    await page.goto('http://localhost:5173/login');
    await page.waitForLoadState('networkidle');
    
    console.log('Filling login form...');
    await page.fill('#email', 'pfadmin@s.com');
    await page.fill('#password', 'pfpass1234');
    
    console.log('Submitting login...');
    await page.click('button[type="submit"]:has-text("登录")');
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('URL after login attempt:', currentUrl);

    const isErrorAlertVisible = await page.locator('p[role="alert"]:has-text("邮箱或密码错误")').isVisible();

    if (currentUrl.includes('/register') && currentUrl.includes('verify=true')) {
      console.log('Redirected to verification page. Resending verification code...');
      await page.click('button:has-text("重新发送验证码")');
      await page.waitForTimeout(2000);

      const code = getLatestCode();
      console.log('Extracted code:', code);
      if (!code) {
        throw new Error('Could not find verification code in log file');
      }

      console.log('Entering verification code...');
      await page.fill('#verification-code', code);
      await page.click('button:has-text("激活并登录")');
      await page.waitForTimeout(3000);
    } else if (isErrorAlertVisible || currentUrl.includes('/login')) {
      console.log('User does not exist or credentials error. Navigating to registration page...');
      await page.goto('http://localhost:5173/register');
      await page.waitForLoadState('networkidle');

      console.log('Registering user...');
      await page.fill('#email', 'pfadmin@s.com');
      await page.fill('#password', 'pfpass1234');
      await page.fill('#confirm', 'pfpass1234');
      await page.click('button[type="submit"]:has-text("注册")');
      await page.waitForTimeout(3000);

      const code = getLatestCode();
      console.log('Extracted code after registration:', code);
      if (!code) {
        throw new Error('Could not find verification code in log file');
      }

      console.log('Entering verification code...');
      await page.fill('#verification-code', code);
      await page.click('button:has-text("激活并登录")');
      await page.waitForTimeout(3000);
    } else {
      console.log('Successfully logged in directly.');
    }

    // Navigating to platform configuration page
    console.log('Navigating to platform page...');
    await page.goto('http://localhost:5173/platform');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify SMTP Password input field toggle
    console.log('Verifying SMTP Password toggle...');
    await page.waitForSelector('#smtp-pass', { timeout: 10000 });
    
    const smtpPassType1 = await page.getAttribute('#smtp-pass', 'type');
    console.log('SMTP Pass Input initial type:', smtpPassType1);
    if (smtpPassType1 !== 'password') {
      throw new Error(`SMTP Password initial type should be "password", got "${smtpPassType1}"`);
    }

    console.log('Clicking SMTP toggle button...');
    await page.click('#smtp-pass + button');
    await page.waitForTimeout(500);

    const smtpPassType2 = await page.getAttribute('#smtp-pass', 'type');
    console.log('SMTP Pass Input type after first click:', smtpPassType2);
    if (smtpPassType2 !== 'text') {
      throw new Error(`SMTP Password type after toggle should be "text", got "${smtpPassType2}"`);
    }

    console.log('Clicking SMTP toggle button again...');
    await page.click('#smtp-pass + button');
    await page.waitForTimeout(500);

    const smtpPassType3 = await page.getAttribute('#smtp-pass', 'type');
    console.log('SMTP Pass Input type after second click:', smtpPassType3);
    if (smtpPassType3 !== 'password') {
      throw new Error(`SMTP Password type after second toggle should be "password", got "${smtpPassType3}"`);
    }

    // Click it once more to leave it in the "text" state for screenshot
    console.log('Toggling back to visible state for screenshot...');
    await page.click('#smtp-pass + button');
    await page.waitForTimeout(500);

    const smtpToggleScreenshot = '/Users/costalong/.gemini/antigravity/brain/7a01513a-c073-446b-807e-af8a213a124a/test_smtp_toggle.png';
    await page.screenshot({ path: smtpToggleScreenshot });
    console.log(`Saved SMTP toggle screenshot to ${smtpToggleScreenshot}`);

    // Verify platform users reset password dialog toggle
    console.log('Navigating to platform users page...');
    await page.goto('http://localhost:5173/platform/users');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('Opening reset password dialog...');
    await page.click('button:has-text("重置密码")');
    await page.waitForTimeout(1000);

    console.log('Verifying reset password inputs...');
    const newPwdType1 = await page.getAttribute('#reset-pwd-new', 'type');
    const confirmPwdType1 = await page.getAttribute('#reset-pwd-confirm', 'type');
    console.log('Reset Password New input type:', newPwdType1);
    console.log('Reset Password Confirm input type:', confirmPwdType1);
    if (newPwdType1 !== 'password' || confirmPwdType1 !== 'password') {
      throw new Error(`Reset password input types should be "password", got new="${newPwdType1}", confirm="${confirmPwdType1}"`);
    }

    console.log('Clicking toggle buttons in reset password dialog...');
    await page.click('#reset-pwd-new + button');
    await page.click('#reset-pwd-confirm + button');
    await page.waitForTimeout(500);

    const newPwdType2 = await page.getAttribute('#reset-pwd-new', 'type');
    const confirmPwdType2 = await page.getAttribute('#reset-pwd-confirm', 'type');
    console.log('Reset Password New input type after toggle:', newPwdType2);
    console.log('Reset Password Confirm input type after toggle:', confirmPwdType2);
    if (newPwdType2 !== 'text' || confirmPwdType2 !== 'text') {
      throw new Error(`Reset password input types should be "text" after toggle, got new="${newPwdType2}", confirm="${confirmPwdType2}"`);
    }

    const resetToggleScreenshot = '/Users/costalong/.gemini/antigravity/brain/7a01513a-c073-446b-807e-af8a213a124a/test_reset_pwd_toggle.png';
    await page.screenshot({ path: resetToggleScreenshot });
    console.log(`Saved Reset Password toggle screenshot to ${resetToggleScreenshot}`);

    console.log('Closing reset password dialog...');
    await page.click('[role="dialog"] button:has-text("取消")');
    await page.waitForTimeout(500);

    // Get organization ID
    console.log('Navigating to root landing page...');
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const rootUrl = page.url();
    console.log('Landing page URL:', rootUrl);
    let orgId = '';
    
    if (rootUrl.includes('/orgs/') && rootUrl.includes('/projects')) {
      const match = rootUrl.match(/\/orgs\/([^\/]+)\//);
      if (match) {
        orgId = match[1];
        console.log('Automatically redirected to organization. Extracted Org ID:', orgId);
      }
    } else {
      console.log('On organization selection landing. Clicking first organization...');
      await page.waitForSelector('ul > li > button', { timeout: 10000 });
      await page.click('ul > li > button');
      await page.waitForTimeout(2000);
      const afterClickUrl = page.url();
      console.log('URL after organization click:', afterClickUrl);
      const match = afterClickUrl.match(/\/orgs\/([^\/]+)\//);
      if (match) {
        orgId = match[1];
        console.log('Extracted Org ID after click:', orgId);
      }
    }

    if (!orgId) {
      throw new Error('Failed to extract organization ID');
    }

    // Navigate to model configurations
    const modelConfigUrl = `http://localhost:5173/orgs/${orgId}/model-configs`;
    console.log(`Navigating to model configs page: ${modelConfigUrl}...`);
    await page.goto(modelConfigUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('Opening model config dialog...');
    // We try to click "添加模型" or "添加第一个模型"
    const addModelLocator = page.locator('button:has-text("添加")');
    await addModelLocator.first().click();
    await page.waitForTimeout(1000);

    console.log('Verifying model config API Key input...');
    await page.waitForSelector('#mc-apikey', { timeout: 10000 });
    const apiKeyType1 = await page.getAttribute('#mc-apikey', 'type');
    console.log('Model API Key initial type:', apiKeyType1);
    if (apiKeyType1 !== 'password') {
      throw new Error(`Model API Key initial type should be "password", got "${apiKeyType1}"`);
    }

    console.log('Clicking model API Key toggle button...');
    await page.click('#mc-apikey + button');
    await page.waitForTimeout(500);

    const apiKeyType2 = await page.getAttribute('#mc-apikey', 'type');
    console.log('Model API Key type after toggle:', apiKeyType2);
    if (apiKeyType2 !== 'text') {
      throw new Error(`Model API Key type should be "text" after toggle, got "${apiKeyType2}"`);
    }

    const modelToggleScreenshot = '/Users/costalong/.gemini/antigravity/brain/7a01513a-c073-446b-807e-af8a213a124a/test_model_toggle.png';
    await page.screenshot({ path: modelToggleScreenshot });
    console.log(`Saved Model Config API Key toggle screenshot to ${modelToggleScreenshot}`);

    console.log('VERIFICATION SUCCESSFUL: All password toggle fields behave as expected!');
    console.log('E2E Toggle test done!');
  } catch (error) {
    console.error('Error during toggle run:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
