import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cfg = window.EHSAN_SUPABASE_CONFIG;
const sb = createClient(cfg.url, cfg.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const gate = document.getElementById('authGate');
const form = document.getElementById('authForm');
const nameField = document.getElementById('authNameRow');
const nameInput = document.getElementById('authName');
const emailInput = document.getElementById('authEmail');
const passwordInput = document.getElementById('authPassword');
const submitButton = document.getElementById('authSubmit');
const switchButton = document.getElementById('authSwitch');
const message = document.getElementById('authMessage');
const statusPanel = document.getElementById('authStatus');
const statusTitle = document.getElementById('authStatusTitle');
const statusCopy = document.getElementById('authStatusCopy');
const signOutButton = document.getElementById('authSignOut');
let mode = 'signin';
let currentUserId = null;
let profileRole = 'user';
let saveTimer = null;
let syncing = false;

function say(text, error = false) {
  message.textContent = text || '';
  message.dataset.error = error ? 'true' : 'false';
}
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function setMode(next) {
  mode = next;
  nameField.hidden = mode !== 'signup';
  nameInput.required = mode === 'signup';
  submitButton.textContent = mode === 'signup' ? 'ساخت حساب کاربری' : 'ورود به حساب';
  switchButton.textContent = mode === 'signup' ? 'قبلاً حساب ساخته‌ام؛ ورود' : 'حساب ندارم؛ ثبت‌نام';
  say('');
}
switchButton.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

form.addEventListener('submit', async event => {
  event.preventDefault();
  submitButton.disabled = true;
  say('در حال ارتباط امن با حساب…');
  try {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { display_name: nameInput.value.trim() }, emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      if (!data.session) {
        say('حساب ثبت شد. اگر تأیید ایمیل فعال باشد، ایمیلت را تأیید کن و بعد وارد شو.');
      } else {
        say('حساب ساخته شد؛ منتظر بررسی وضعیت حساب…');
        await handleSession(data.session);
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await handleSession(data.session);
    }
  } catch (error) {
    say(error?.message || 'ورود یا ثبت‌نام انجام نشد.', true);
  } finally {
    submitButton.disabled = false;
  }
});

async function showGate(title, copy, allowSignIn = false) {
  document.body.classList.add('auth-locked');
  gate.hidden = false;
  form.hidden = !allowSignIn;
  statusPanel.hidden = allowSignIn;
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
  if (allowSignIn) setMode('signin');
}
async function saveCloud(snapshot) {
  if (!currentUserId || profileRole !== 'admin' && document.body.classList.contains('auth-locked')) return;
  const { error } = await sb.from('user_records').upsert({
    user_id: currentUserId,
    module: 'other',
    record_type: 'app_state',
    data: snapshot,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,module,record_type' });
  if (error) {
    console.error('Cloud save failed:', error.message);
    return;
  }
}
async function loadCloud(userId) {
  const { data, error } = await sb.from('user_records')
    .select('data')
    .eq('user_id', userId)
    .eq('module', 'other')
    .eq('record_type', 'app_state')
    .maybeSingle();
  if (error) throw error;
  if (data?.data && typeof data.data === 'object') {
    window.__ehsanLoadState?.(data.data);
  } else {
    await saveCloud(window.__ehsanGetState?.() || {});
  }
}
function addAdminButton() {
  let button = document.getElementById('adminUsersBtn');
  if (profileRole !== 'admin') {
    button?.remove();
    return;
  }
  if (button) return;
  button = document.createElement('button');
  button.id = 'adminUsersBtn';
  button.className = 'secondary';
  button.textContent = 'مدیریت کاربران';
  document.querySelector('.side-bottom')?.prepend(button);
  button.addEventListener('click', openAdminPanel);
}
async function handleSession(session) {
  const user = session?.user;
  if (!user) {
    currentUserId = null;
    profileRole = 'user';
    addAdminButton();
    await showGate('به فضای شخصی احسان خوش آمدی 🌿', 'برای ذخیره‌سازی امن و همگام‌سازی اطلاعات، وارد شو یا حساب بساز.', true);
    return;
  }
  if (currentUserId === user.id && !document.body.classList.contains('auth-locked')) return;
  currentUserId = user.id;
  await showGate('در حال بررسی حساب…', 'وضعیت دسترسی از دیتابیس بررسی می‌شود.');
  let profile = null;
  let profileError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await sb.from('profiles').select('id,display_name,account_status,role,created_at').eq('id', user.id).maybeSingle();
    profile = result.data;
    profileError = result.error;
    if (profile || profileError) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (profileError) {
    await showGate('بررسی حساب ناموفق بود', 'اتصال برقرار است، اما وضعیت حساب خوانده نشد. لطفاً دوباره تلاش کن یا تنظیمات دیتابیس را بررسی کن.');
    statusCopy.textContent += ' (' + profileError.message + ')';
    return;
  }
  if (!profile) {
    await showGate('حساب در انتظار آماده‌سازی است', 'پروفایل هنوز ساخته نشده. یک بار خارج شو و دوباره وارد شو.');
    return;
  }
  profileRole = profile.role || 'user';
  addAdminButton();
  if (profile.account_status === 'pending') {
    await showGate('ثبت‌نامت دریافت شد ⏳', 'حساب تو تا تأیید مدیر غیرفعال می‌ماند. پس از تأیید می‌توانی به فضای شخصی و اطلاعاتت دسترسی داشته باشی.');
    return;
  }
  if (profile.account_status !== 'approved') {
    await showGate('دسترسی حساب متوقف است', 'این حساب در حال حاضر اجازه ورود به فضای شخصی را ندارد.');
    return;
  }
  document.body.classList.remove('auth-locked');
  gate.hidden = true;
  form.hidden = true;
  statusPanel.hidden = true;
  const profileName = profile.display_name || user.email || 'کاربر';
  const nameEl = document.querySelector('.profile strong');
  const statusEl = document.querySelector('.profile span');
  if (nameEl) nameEl.textContent = profileName;
  if (statusEl) statusEl.textContent = 'ذخیره‌سازی ابری فعال';
  try {
    await loadCloud(user.id);
  } catch (error) {
    console.error('Cloud load failed:', error.message);
    alert('حساب وارد شد، اما اطلاعات ابری بارگذاری نشد. لطفاً اتصال دیتابیس را بررسی کن.');
  }
}
signOutButton.addEventListener('click', async () => {
  await sb.auth.signOut();
  await handleSession(null);
});
window.addEventListener('ehsan-state-saved', event => {
  if (!currentUserId || document.body.classList.contains('auth-locked')) return;
  const snapshot = event.detail || window.__ehsanGetState?.();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCloud(snapshot), 650);
});

async function openAdminPanel() {
  const { data: profiles, error } = await sb.from('profiles')
    .select('id,display_name,account_status,role,created_at')
    .order('created_at', { ascending: false });
  if (error) { alert('فهرست کاربران خوانده نشد: ' + error.message); return; }
  let panel = document.getElementById('adminPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'adminPanel';
    panel.className = 'modal-backdrop open';
    panel.innerHTML = '<section class="modal admin-modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>مدیریت حساب‌ها</h3><button type="button" id="adminClose">×</button></div><p class="subtle">از اینجا حساب بساز، دسترسی بده یا حساب‌های در انتظار را تأیید کن. رمز اولیه را امن به کاربر بده و از او بخواه بعداً تغییرش دهد.</p><details open style="margin:14px 0 18px"><summary style="cursor:pointer;font-weight:700;padding:8px 0">＋ افزودن کاربر جدید</summary><form id="adminCreateUserForm" style="padding-top:12px"><div class="form-row"><label for="newUserName">نام نمایشی</label><input id="newUserName" required maxlength="80" placeholder="نام کاربر"></div><div class="form-row"><label for="newUserEmail">ایمیل</label><input id="newUserEmail" type="email" required autocomplete="off" placeholder="user@example.com"></div><div class="form-row"><label for="newUserPassword">رمز اولیه (حداقل ۸ کاراکتر)</label><input id="newUserPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="رمز موقت"></div><div class="form-row"><label for="newUserRole">نوع حساب</label><select id="newUserRole"><option value="user">کاربر عادی</option><option value="admin">مدیر</option></select></div><div class="form-row"><label style="display:flex;align-items:center;gap:8px"><input id="newUserApproved" type="checkbox" style="width:auto"> فعال‌سازی فوری حساب</label></div><div id="adminCreateMessage" class="auth-message" role="status"></div><button class="primary" type="submit" style="width:100%">ساخت حساب</button></form></details><div id="adminUserList"></div></section>';
    document.body.append(panel);
    panel.querySelector('#adminClose').addEventListener('click', () => panel.remove());
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });
  }
  const createForm = panel.querySelector('#adminCreateUserForm');
  if (createForm && !createForm.dataset.bound) {
    createForm.dataset.bound = 'true';
    createForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = createForm.querySelector('button[type="submit"]');
      const msg = panel.querySelector('#adminCreateMessage');
      button.disabled = true;
      msg.textContent = 'در حال ساخت حساب…';
      msg.dataset.error = 'false';
      try {
        const { data: sessionData, error: sessionError } = await sb.auth.getSession();
        if (sessionError || !sessionData.session) throw new Error('نشست ورود پیدا نشد؛ دوباره وارد شو.');
        const response = await fetch(cfg.url + '/functions/v1/admin-create-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': cfg.publishableKey,
            'Authorization': 'Bearer ' + sessionData.session.access_token
          },
          body: JSON.stringify({
            display_name: panel.querySelector('#newUserName').value.trim(),
            email: panel.querySelector('#newUserEmail').value.trim(),
            password: panel.querySelector('#newUserPassword').value,
            role: panel.querySelector('#newUserRole').value,
            approved: panel.querySelector('#newUserApproved').checked
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'ساخت حساب انجام نشد.');
        msg.textContent = 'حساب ساخته شد: ' + (result.user?.email || '');
        createForm.reset();
        await openAdminPanel();
      } catch (error) {
        msg.textContent = error.message || 'ساخت حساب انجام نشد.';
        msg.dataset.error = 'true';
      } finally {
        button.disabled = false;
      }
    });
  }
  const list = panel.querySelector('#adminUserList');
  list.innerHTML = profiles.map(p => '<div class="admin-user"><div><strong>' + esc(p.display_name || 'بدون نام') + '</strong><small>' + esc(p.account_status) + ' · ' + esc(new Date(p.created_at).toLocaleDateString('fa-IR')) + '</small></div><div class="admin-actions">' +
    (p.id === currentUserId ? '<span class="tag">حساب فعلی</span>' : (p.account_status !== 'approved' ? '<button class="primary" data-user="' + esc(p.id) + '" data-status="approved">تأیید</button>' : '<button class="secondary" data-user="' + esc(p.id) + '" data-status="suspended">تعلیق</button>')) +
    (p.role !== 'admin' ? '' : '<span class="tag">مدیر</span>') + '</div></div>').join('') || '<p class="empty">هنوز کاربری ثبت‌نام نکرده.</p>';
  list.querySelectorAll('[data-user]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('وضعیت این حساب تغییر کند؟')) return;
    const { error: updateError } = await sb.from('profiles')
      .update({ account_status: button.dataset.status, updated_at: new Date().toISOString() })
      .eq('id', button.dataset.user);
    if (updateError) { alert('تغییر وضعیت انجام نشد: ' + updateError.message); return; }
    await openAdminPanel();
  }));
}
sb.auth.onAuthStateChange((_event, session) => {
  queueMicrotask(() => handleSession(session));
});
sb.auth.getSession().then(({ data }) => handleSession(data.session)).catch(error => {
  showGate('اتصال حساب آماده نیست', error.message, true);
});
