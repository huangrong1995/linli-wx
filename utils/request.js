const { BASE_URL, STORAGE_KEYS } = require('./constants');

function _tokenHeader() {
  const token = wx.getStorageSync(STORAGE_KEYS.TOKEN);
  return token ? { Authorization: 'Token ' + token } : {};
}

function _clearAuth() {
  wx.removeStorageSync(STORAGE_KEYS.TOKEN);
  wx.removeStorageSync(STORAGE_KEYS.PROFILE);
}

function _handleStatus(res, resolve, reject) {
  const body = res.data || {};
  if (res.statusCode === 401) {
    _clearAuth();
    reject(Object.assign(new Error(body.detail || '未登录'), { statusCode: 401 }));
    return;
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    resolve(body);
  } else {
    reject(Object.assign(new Error(body.detail || '请求失败'), { statusCode: res.statusCode }));
  }
}

function request(options) {
  const { url, method = 'GET', data = {}, header = {}, showLoading = false } = options;
  if (showLoading) wx.showLoading({ title: '加载中', mask: true });
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: Object.assign(_tokenHeader(), { 'content-type': 'application/json' }, header),
      success(res) {
        if (showLoading) wx.hideLoading();
        _handleStatus(res, resolve, reject);
      },
      fail(err) {
        if (showLoading) wx.hideLoading();
        reject(Object.assign(new Error('网络请求失败'), err));
      },
    });
  });
}

function uploadFile(options) {
  const { url, filePath, name = 'file', formData = {}, showLoading = true } = options;
  if (showLoading) wx.showLoading({ title: '上传中', mask: true });
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + url,
      filePath,
      name,
      formData,
      header: _tokenHeader(),
      success(res) {
        if (showLoading) wx.hideLoading();
        let body = null;
        try { body = JSON.parse(res.data); } catch (e) { body = { detail: '解析失败' }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(Object.assign(new Error(body.detail || '上传失败'), { statusCode: res.statusCode }));
      },
      fail(err) {
        if (showLoading) wx.hideLoading();
        reject(Object.assign(new Error('上传失败'), err));
      },
    });
  });
}

module.exports = { request, uploadFile };