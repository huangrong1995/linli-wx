const auth = require('./utils/auth');

App({
  globalData: { profile: null },
  onLaunch() {
    // 启动静默登录（可失败，浏览仍可用）
    auth.ensureLogin().then((profile) => {
      this.globalData.profile = profile;
    }).catch(() => {});
  },
});