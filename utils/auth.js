const { STORAGE_KEYS } = require('./constants');
const { request } = require('./request');

function setToken(token) { wx.setStorageSync(STORAGE_KEYS.TOKEN, token); }
function getToken() { return wx.getStorageSync(STORAGE_KEYS.TOKEN) || null; }
function setProfile(p) { wx.setStorageSync(STORAGE_KEYS.PROFILE, p); }
function getProfile() { return wx.getStorageSync(STORAGE_KEYS.PROFILE) || null; }

function silentLogin() {
  // 静默 wx.login → 后端换取 openid/token
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) return reject(new Error('login failed'));
        request({ url: '/api/auth/wx-login/', method: 'POST', data: { code: res.code } })
          .then((data) => {
            setToken(data.token);
            setProfile(data.user);
            resolve(data);
          })
          .catch(reject);
      },
      fail: reject,
    });
  });
}

function ensureLogin() {
  // 有 token 直接过；否则静默登录
  if (getToken()) return Promise.resolve(getProfile());
  return silentLogin();
}

function isApproved() {
  const p = getProfile();
  return !!p && p.status === 'approved';
}

function needProfile() {
  const p = getProfile();
  return !p || !(p.phone && p.community) || p.status !== 'approved';
}

function logout() {
  const req = getToken()
    ? request({ url: '/api/auth/logout/', method: 'POST' }).catch(() => null)
    : Promise.resolve();
  return req.then(() => {
    wx.removeStorageSync(STORAGE_KEYS.TOKEN);
    wx.removeStorageSync(STORAGE_KEYS.PROFILE);
  });
}

module.exports = { setToken, getToken, setProfile, getProfile, silentLogin, ensureLogin, isApproved, needProfile, logout };